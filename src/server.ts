import { createWorkersAI } from "workers-ai-provider";
import { callable, routeAgentRequest, type Schedule } from "agents";
import { getSchedulePrompt, scheduleSchema } from "agents/schedule";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  tool,
  type ModelMessage
} from "ai";
import { z } from "zod";
import * as cheerio from "cheerio";

/**
 * The AI SDK's downloadAssets step runs `new URL(data)` on every file
 * part's string data. Data URIs parse as valid URLs, so it tries to
 * HTTP-fetch them and fails. Decode to Uint8Array so the SDK treats
 * them as inline data instead.
 */
function inlineDataUrls(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "user" || typeof msg.content === "string") return msg;
    return {
      ...msg,
      content: msg.content.map((part) => {
        if (part.type !== "file" || typeof part.data !== "string") return part;
        const match = part.data.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) return part;
        const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
        return { ...part, data: bytes, mediaType: match[1] };
      })
    };
  });
}

export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;

  onStart() {
    this
      .sql`CREATE TABLE IF NOT EXISTS marketing_news (id INTEGER PRIMARY KEY, headline TEXT, subheadline TEXT, ctaText TEXT)`;
    this
      .sql`CREATE TABLE IF NOT EXISTS content_ideas (id INTEGER PRIMARY KEY, title TEXT, content TEXT, timestamp TEXT)`;

    // Configure OAuth popup behavior for MCP servers that require authentication
    this.mcp.configureOAuthCallback({
      customHandler: (result) => {
        if (result.authSuccess) {
          return new Response("<script>window.close();</script>", {
            headers: { "content-type": "text/html" },
            status: 200
          });
        }
        return new Response(
          `Authentication Failed: ${result.authError || "Unknown error"}`,
          { headers: { "content-type": "text/plain" }, status: 400 }
        );
      }
    });
  }

  @callable()
  async getNews() {
    const results = this
      .sql`SELECT * FROM marketing_news ORDER BY id DESC LIMIT 1`;
    const rows = [...results];
    if (rows.length > 0) return rows[0];
    return {
      headline: '"Pieces For You" EP &middot; Out Now!',
      subheadline: "New tees & pins just arrived &middot; Shop Now",
      ctaText: "Listen to the new EP &middot; Shop Merch"
    };
  }

  @callable()
  async addServer(name: string, url: string) {
    return await this.addMcpServer(name, url);
  }

  @callable()
  async removeServer(serverId: string) {
    await this.removeMcpServer(serverId);
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const mcpTools = this.mcp.getAITools();
    const workersai = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersai("@cf/moonshotai/kimi-k2.5", {
        sessionAffinity: this.sessionAffinity
      }),
      system: `You are the Cbarrgs Marketing Agent. You can check the weather, get the user's timezone, run calculations, and schedule tasks. You can also update the marketing news on the Cbarrgs website using the updateMarketingNews tool.

${getSchedulePrompt({ date: new Date() })}

If the user asks to schedule a task, use the schedule tool to schedule the task.`,
      // Prune old tool calls to save tokens on long conversations
      messages: pruneMessages({
        messages: inlineDataUrls(await convertToModelMessages(this.messages)),
        toolCalls: "before-last-2-messages"
      }),
      tools: {
        // MCP tools from connected servers
        ...mcpTools,

        // Marketing Tool: Update news
        updateMarketingNews: tool({
          description:
            "Update the marketing news displayed on the Cbarrgs website.",
          inputSchema: z.object({
            headline: z
              .string()
              .describe(
                "The main headline for the news, e.g. 'Pieces For You EP Out Now!'"
              ),
            subheadline: z
              .string()
              .describe("Secondary text, e.g. 'New tees & pins just arrived'"),
            ctaText: z
              .string()
              .describe("Call to action text, e.g. 'Listen & Shop'")
          }),
          execute: async ({ headline, subheadline, ctaText }) => {
            this
              .sql`INSERT INTO marketing_news (headline, subheadline, ctaText) VALUES (${headline}, ${subheadline}, ${ctaText})`;
            return `Marketing news updated successfully!`;
          }
        }),

        // Scraper Tool
        scrapeWebsite: tool({
          description:
            "Fetch and read the text content of any public URL. Use this for competitor analysis, reading news articles, or exploring music blogs.",
          inputSchema: z.object({
            url: z.string().describe("The URL to scrape")
          }),
          execute: async ({ url }) => {
            try {
              const res = await fetch(url);
              if (!res.ok) return `Error fetching ${url}: ${res.statusText}`;
              const html = await res.text();
              const $ = cheerio.load(html);
              $("script, style, noscript, iframe, img, svg").remove();
              const text = $("body").text().replace(/\\s+/g, " ").trim();
              return text.substring(0, 5000);
            } catch (e: unknown) {
              return `Error scraping ${url}: ${e instanceof Error ? e.message : String(e)}`;
            }
          }
        }),

        // Web Search Tool
        searchWeb: tool({
          description:
            "Perform a web search using a free API (DuckDuckGo HTML proxy) to find current trends, marketing news, or social media events.",
          inputSchema: z.object({
            query: z.string().describe("The search query")
          }),
          execute: async ({ query }) => {
            try {
              const res = await fetch(
                `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
                {
                  headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                  }
                }
              );
              if (!res.ok) return "Search failed";
              const html = await res.text();
              const $ = cheerio.load(html);
              let results: string[] = [];
              $(".result__body").each((i, el) => {
                if (i >= 5) return;
                const title = $(el).find(".result__title").text().trim();
                const snippet = $(el).find(".result__snippet").text().trim();
                const link = $(el).find(".result__url").text().trim();
                results.push(
                  `Title: ${title}\\nSnippet: ${snippet}\\nURL: ${link}`
                );
              });
              return results.length > 0
                ? results.join("\\n\\n")
                : "No results found.";
            } catch (e: unknown) {
              return `Error searching: ${e instanceof Error ? e.message : String(e)}`;
            }
          }
        }),

        // Save Content Idea Tool
        saveContentIdea: tool({
          description:
            "Save a brainstormed marketing or social media content idea to the database for later use.",
          inputSchema: z.object({
            title: z.string().describe("A short, catchy title for the idea"),
            content: z
              .string()
              .describe(
                "The full details of the content idea (format, caption, audio, etc.)"
              )
          }),
          execute: async ({ title, content }) => {
            const timestamp = new Date().toISOString();
            this
              .sql`INSERT INTO content_ideas (title, content, timestamp) VALUES (${title}, ${content}, ${timestamp})`;
            return `Saved idea "${title}" successfully.`;
          }
        }),

        // List Content Ideas Tool
        listContentIdeas: tool({
          description:
            "List all previously saved content ideas from the database.",
          inputSchema: z.object({}),
          execute: async () => {
            const results = this
              .sql`SELECT * FROM content_ideas ORDER BY id DESC LIMIT 10`;
            const rows = [...results];
            if (rows.length === 0) return "No content ideas saved yet.";
            return rows
              .map((r) => {
                const idea = r as {
                  id: number;
                  title: string;
                  content: string;
                  timestamp: string;
                };
                return `ID: ${idea.id} | Title: ${idea.title}\nDetails: ${idea.content}\nSaved: ${idea.timestamp}`;
              })
              .join("\n\n---\n\n");
          }
        }),

        // Generate Social Post
        generateSocialPost: tool({
          description:
            "Format a raw idea into a highly engaging, viral-optimized social media post for TikTok, Instagram Reels, or Twitter.",
          inputSchema: z.object({
            platform: z.enum(["TikTok", "Instagram", "Twitter"]),
            topic: z.string().describe("The topic or raw idea to format"),
            tone: z
              .string()
              .describe(
                "The desired tone (e.g., 'mysterious', 'hype', 'educational')"
              )
          }),
          execute: async ({ platform, topic, tone }) => {
            return `Instructions for Agent:\\nBased on the following request:\\n- Platform: ${platform}\\n- Topic: ${topic}\\n- Tone: ${tone}\\n\\nPlease generate a viral post following these rules:\\n1. Hook (first 3 seconds / first sentence) must be immediately engaging.\\n2. Provide a visual/video format suggestion.\\n3. Write a compelling caption.\\n4. Add 3-5 hyper-relevant, low-competition hashtags.\\n5. Provide an audio/sound suggestion (trending or original).`;
          }
        }),

        // Server-side tool: runs automatically on the server
        getWeather: tool({
          description: "Get the current weather for a city",
          inputSchema: z.object({
            city: z.string().describe("City name")
          }),
          execute: async ({ city }) => {
            // Replace with a real weather API in production
            const conditions = ["sunny", "cloudy", "rainy", "snowy"];
            const temp = Math.floor(Math.random() * 30) + 5;
            return {
              city,
              temperature: temp,
              condition:
                conditions[Math.floor(Math.random() * conditions.length)],
              unit: "celsius"
            };
          }
        }),

        // Client-side tool: no execute function — the browser handles it
        getUserTimezone: tool({
          description:
            "Get the user's timezone from their browser. Use this when you need to know the user's local time.",
          inputSchema: z.object({})
        }),

        // Approval tool: requires user confirmation before executing
        calculate: tool({
          description:
            "Perform a math calculation with two numbers. Requires user approval for large numbers.",
          inputSchema: z.object({
            a: z.number().describe("First number"),
            b: z.number().describe("Second number"),
            operator: z
              .enum(["+", "-", "*", "/", "%"])
              .describe("Arithmetic operator")
          }),
          needsApproval: async ({ a, b }) =>
            Math.abs(a) > 1000 || Math.abs(b) > 1000,
          execute: async ({ a, b, operator }) => {
            const ops: Record<string, (x: number, y: number) => number> = {
              "+": (x, y) => x + y,
              "-": (x, y) => x - y,
              "*": (x, y) => x * y,
              "/": (x, y) => x / y,
              "%": (x, y) => x % y
            };
            if (operator === "/" && b === 0) {
              return { error: "Division by zero" };
            }
            return {
              expression: `${a} ${operator} ${b}`,
              result: ops[operator](a, b)
            };
          }
        }),

        scheduleTask: tool({
          description:
            "Schedule a task to be executed at a later time. Use this when the user asks to be reminded or wants something done later.",
          inputSchema: scheduleSchema,
          execute: async ({ when, description }) => {
            if (when.type === "no-schedule") {
              return "Not a valid schedule input";
            }
            const input =
              when.type === "scheduled"
                ? when.date
                : when.type === "delayed"
                  ? when.delayInSeconds
                  : when.type === "cron"
                    ? when.cron
                    : null;
            if (!input) return "Invalid schedule type";
            try {
              this.schedule(input, "executeTask", description, {
                idempotent: true
              });
              return `Task scheduled: "${description}" (${when.type}: ${input})`;
            } catch (error) {
              return `Error scheduling task: ${error}`;
            }
          }
        }),

        getScheduledTasks: tool({
          description: "List all tasks that have been scheduled",
          inputSchema: z.object({}),
          execute: async () => {
            const tasks = this.getSchedules();
            return tasks.length > 0 ? tasks : "No scheduled tasks found.";
          }
        }),

        cancelScheduledTask: tool({
          description: "Cancel a scheduled task by its ID",
          inputSchema: z.object({
            taskId: z.string().describe("The ID of the task to cancel")
          }),
          execute: async ({ taskId }) => {
            try {
              this.cancelSchedule(taskId);
              return `Task ${taskId} cancelled.`;
            } catch (error) {
              return `Error cancelling task: ${error}`;
            }
          }
        })
      },
      stopWhen: stepCountIs(5),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }

  async executeTask(description: string, _task: Schedule<string>) {
    // Do the actual work here (send email, call API, etc.)
    console.log(`Executing scheduled task: ${description}`);

    // Notify connected clients via a broadcast event.
    // We use broadcast() instead of saveMessages() to avoid injecting
    // into chat history — that would cause the AI to see the notification
    // as new context and potentially loop.
    this.broadcast(
      JSON.stringify({
        type: "scheduled-task",
        description,
        timestamp: new Date().toISOString()
      })
    );
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    if (url.pathname === "/api/news") {
      // Fetch news from the default ChatAgent
      const agentId = env.ChatAgent.idFromName("default");
      const agent = env.ChatAgent.get(agentId);
      const news = await agent.getNews();

      return new Response(JSON.stringify(news), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;

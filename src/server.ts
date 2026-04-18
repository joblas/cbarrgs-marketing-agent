import { createWorkersAI } from "workers-ai-provider";
import { callable, routeAgentRequest, type Schedule } from "agents";
import { scheduleSchema } from "agents/schedule";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  stepCountIs,
  streamText,
  tool,
  generateText,
  convertToModelMessages,
  pruneMessages
} from "ai";
import { z } from "zod";
import * as cheerio from "cheerio";

export class ChatAgent extends AIChatAgent<Env> {
  // Max messages to keep in history
  maxPersistedMessages = 100;

  onStart() {
    this
      .sql`CREATE TABLE IF NOT EXISTS marketing_news (id INTEGER PRIMARY KEY, headline TEXT, subheadline TEXT, ctaText TEXT)`;
    this
      .sql`CREATE TABLE IF NOT EXISTS content_ideas (id INTEGER PRIMARY KEY, title TEXT, content TEXT, timestamp TEXT)`;
    this
      .sql`CREATE TABLE IF NOT EXISTS knowledge_base (id INTEGER PRIMARY KEY, content TEXT, metadata TEXT, source TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`;

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

  async performSearch(query: string): Promise<string> {
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
      const results: string[] = [];
      $(".result__body").each((i, el) => {
        if (i >= 5) return;
        const title = $(el).find(".result__title").text().trim();
        const snippet = $(el).find(".result__snippet").text().trim();
        const link = $(el).find(".result__url").text().trim();
        results.push(`Title: ${title}\nSnippet: ${snippet}\nURL: ${link}`);
      });
      return results.length > 0 ? results.join("\n\n") : "No results found.";
    } catch (e: unknown) {
      return `Error searching: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  getSystemPrompt() {
    const knowledge = this
      .sql`SELECT content FROM knowledge_base ORDER BY timestamp DESC LIMIT 10`;
    const context = [...knowledge].map((k) => k.content).join("\n---\n");

    return `You are Cbarrgs-Marketing, a world-class strategic marketing agent for the Cbarrgs ecosystem.
Your goal is to grow Cbarrgs' social presence and brand value through data-driven decisions.

Knowledge Base Context (Loaded Docs/Links):
${context || "No specific documents loaded yet."}

Core Responsibilities:
1. Strategic Planning: Create comprehensive marketing campaigns for new releases (like "Pieces For You").
2. Autonomous Research: Use search and scraping tools to find trends, competitor stats, and viral hooks.
3. Content Generation: Write high-converting captions, scripts for TikTok/Reels, and newsletter copy.
4. Website Management: Keep cbarrgs.com updated with the latest news and marketing headlines.

Thinking Style:
- Be proactive and strategic. Don't just answer; suggest the next step.
- Use reasoning to explain *why* a specific strategy will work.
- If a tool fails (like scraping), pivot to a different tool (like search) to find the data.
- Maintain a consistent "Cbarrgs" brand voice: edgy, authentic, and artist-focused.

Admin Access: cbarrgs@gmail.com and joe@joestechsolutions.com have full control.
Current Project: "Pieces For You" EP. Focus on scaling Instagram and TikTok.`;
  }

  getTools() {
    const mcpTools = this.mcp.getAITools();
    return {
      ...mcpTools,

      updateMarketingNews: tool({
        description:
          "Update the marketing news displayed on the Cbarrgs website.",
        inputSchema: z.object({
          headline: z
            .string()
            .describe("The main headline, e.g. 'New EP Out Now!'"),
          subheadline: z
            .string()
            .describe("Secondary text, e.g. 'Stream on Spotify'"),
          ctaText: z.string().describe("Button text, e.g. 'Listen Now'")
        }),
        execute: async ({ headline, subheadline, ctaText }) => {
          this
            .sql`INSERT INTO marketing_news (headline, subheadline, ctaText) VALUES (${headline}, ${subheadline}, ${ctaText})`;
          return `Marketing news updated successfully!`;
        }
      }),

      searchWeb: tool({
        description: "Search the web for news, trends, and information.",
        inputSchema: z.object({
          query: z.string().describe("The search query")
        }),
        execute: async ({ query }) => {
          return await this.performSearch(query);
        }
      }),

      searchSocialStats: tool({
        description:
          "Search for social media stats (followers, engagement) when direct scraping is blocked.",
        inputSchema: z.object({
          platform: z
            .string()
            .describe("The social platform (e.g. instagram, tiktok)"),
          username: z.string().describe("The username to search for")
        }),
        execute: async ({ platform, username }) => {
          const query = `${platform} ${username} follower count statistics`;
          return await this.performSearch(query);
        }
      }),

      scrapeWebsite: tool({
        description: "Fetch and read the text content of any public URL.",
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
            const text = $("body").text().replace(/\s+/g, " ").trim();
            return text.substring(0, 5000);
          } catch (e: unknown) {
            return `Error scraping ${url}: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
      }),

      addKnowledge: tool({
        description:
          "Add a document, link content, or important context to the agent's long-term memory.",
        inputSchema: z.object({
          content: z.string().describe("The text content or summary to store"),
          source: z.string().describe("The source URL or file name")
        }),
        execute: async ({ content, source }) => {
          this
            .sql`INSERT INTO knowledge_base (content, source) VALUES (${content}, ${source})`;
          return `Knowledge successfully stored from: ${source}`;
        }
      }),

      saveContentIdea: tool({
        description: "Save a marketing or social media content idea.",
        inputSchema: z.object({
          title: z.string().describe("Title for the idea"),
          content: z.string().describe("Full details of the idea")
        }),
        execute: async ({ title, content }) => {
          const timestamp = new Date().toISOString();
          this
            .sql`INSERT INTO content_ideas (title, content, timestamp) VALUES (${title}, ${content}, ${timestamp})`;
          return `Saved idea "${title}" successfully.`;
        }
      }),

      listContentIdeas: tool({
        description: "List all saved content ideas.",
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

      generateSocialPost: tool({
        description: "Format an idea into a viral social media post.",
        inputSchema: z.object({
          platform: z.enum(["TikTok", "Instagram", "Twitter"]),
          topic: z.string().describe("The topic to format"),
          tone: z.string().describe("The tone, e.g. 'mysterious', 'hype'")
        }),
        execute: async ({ platform, topic, tone }) => {
          return `Instructions for Agent:\nPlatform: ${platform}\nTopic: ${topic}\nTone: ${tone}\nGenerate a viral post with a hook, visual suggestion, caption, and hashtags.`;
        }
      }),

      calculate: tool({
        description: "Perform a math calculation.",
        inputSchema: z.object({
          a: z.number(),
          b: z.number(),
          operator: z.enum(["+", "-", "*", "/", "%"])
        }),
        execute: async ({ a, b, operator }) => {
          const ops: Record<string, (x: number, y: number) => number> = {
            "+": (x, y) => x + y,
            "-": (x, y) => x - y,
            "*": (x, y) => x * y,
            "/": (x, y) => x / y,
            "%": (x, y) => x % y
          };
          return ops[operator](a, b);
        }
      }),

      schedule: tool({
        description: "Schedule a task to run later.",
        inputSchema: scheduleSchema,
        execute: async (task) => {
          let when: string | number | Date;
          if (task.when.type === "scheduled") when = new Date(task.when.date);
          else if (task.when.type === "delayed")
            when = task.when.delayInSeconds;
          else if (task.when.type === "cron") when = task.when.cron;
          else return "Invalid schedule type.";

          await this.schedule(when, "executeTask", task.description);
          return `Task scheduled: ${task.description}`;
        }
      })
    };
  }

  @callable()
  async handleTelegramUpdate(update: unknown) {
    const tgUpdate = update as {
      message?: {
        text?: string;
        chat: { id: number };
      };
    };
    if (!tgUpdate.message || !tgUpdate.message.text) return;
    const chatId = tgUpdate.message.chat.id;
    const userText = tgUpdate.message.text;

    const workersai = createWorkersAI({ binding: this.env.AI });
    const { text } = await generateText({
      model: workersai("@cf/openai/gpt-oss-120b"),
      system: this.getSystemPrompt(),
      prompt: userText,
      tools: this.getTools()
    });

    await fetch(
      `https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text })
      }
    );
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

  async onChatMessage(_onFinish: unknown, _options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const result = streamText({
      model: workersai("@cf/openai/gpt-oss-120b", {
        sessionAffinity: this.sessionAffinity
      }),
      system: this.getSystemPrompt(),
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      tools: this.getTools(),
      stopWhen: stepCountIs(5)
    });
    return result.toUIMessageStreamResponse();
  }

  async executeTask(description: string, _task: Schedule<string>) {
    this.broadcast(
      JSON.stringify({
        type: "assistant",
        content: `System: Executed scheduled task: ${description}`
      })
    );
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    if (url.pathname === "/api/telegram" && request.method === "POST") {
      const update = await request.json();
      const agentId = env.ChatAgent.idFromName("default");
      const agent = env.ChatAgent.get(agentId);
      ctx.waitUntil(agent.handleTelegramUpdate(update));
      return new Response("OK");
    }

    if (url.pathname === "/api/news") {
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

    const response = await routeAgentRequest(request, env);
    if (response) return response;

    return await env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;

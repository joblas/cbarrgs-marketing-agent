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
    try {
      this
        .sql`CREATE TABLE IF NOT EXISTS marketing_news (id INTEGER PRIMARY KEY, headline TEXT, subheadline TEXT, ctaText TEXT)`;
      this
        .sql`CREATE TABLE IF NOT EXISTS content_ideas (id INTEGER PRIMARY KEY, title TEXT, content TEXT, timestamp TEXT)`;
      try {
        this.sql`DROP TABLE IF EXISTS knowledge_base`;
      } catch {}
      this.sql`CREATE TABLE knowledge_base (
        id INTEGER PRIMARY KEY, 
        content TEXT, 
        wing TEXT, 
        room TEXT, 
        drawer TEXT, 
        source TEXT, 
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )`;
      this
        .sql`CREATE INDEX IF NOT EXISTS idx_kb_wing_room ON knowledge_base (wing, room)`;
      this
        .sql`CREATE INDEX IF NOT EXISTS idx_kb_timestamp ON knowledge_base (timestamp)`;

      try {
        this.sql`DROP TABLE IF EXISTS agent_diary`;
      } catch {}
      this.sql`CREATE TABLE agent_diary (
        id INTEGER PRIMARY KEY,
        entry TEXT,
        reflection TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )`;
      this
        .sql`CREATE INDEX IF NOT EXISTS idx_diary_timestamp ON agent_diary (timestamp)`;

      try {
        this.sql`DROP TABLE IF EXISTS users`;
      } catch {}
      this.sql`CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT,
      password TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`;

      try {
        this.sql`DROP TABLE IF EXISTS user_sessions`;
      } catch {}
      this.sql`CREATE TABLE user_sessions (
      id INTEGER PRIMARY KEY,
      user_email TEXT,
      session_id TEXT,
      is_group BOOLEAN DEFAULT FALSE,
      participants TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`;

      this
        .sql`CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_email)`;
    } catch (e) {
      console.error("onStart error:", e);
    }

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
      return results.length > 0
        ? results.join("\n\n---\n\n")
        : "No results found.";
    } catch (e: unknown) {
      return `Error searching: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  getSystemPrompt() {
    const knowledge = this
      .sql`SELECT content, wing, room FROM knowledge_base ORDER BY timestamp DESC LIMIT 10`;
    const context = [...knowledge]
      .map((k) => `[${k.wing} > ${k.room}] ${k.content}`)
      .join("\n---\n");

    const diary = this
      .sql`SELECT entry, reflection FROM agent_diary ORDER BY timestamp DESC LIMIT 5`;
    const diaryContext = [...diary]
      .map((d) => `Observation: ${d.entry}\nReflection: ${d.reflection}`)
      .join("\n---\n");

    return `### ROLE: Cbarrgs AI Assistant
Strategic marketing agent for Cbarrgs ecosystem with advanced reasoning capabilities.

### CONTEXT:
- Palace (Knowledge): ${context || "Empty"}
- Diary (Reasoning): ${diaryContext || "None"}
- Admin: cbarrgs@gmail.com, joe@joestechsolutions.com
- Focus: "Pieces For You" EP Rollout

### CORE SKILLS:
- marketing-ideas: Creative cost-effective growth.
- gtm-strategy: Launch execution for releases.
- growth-loops: Scalable follower acquisition.
- value-proposition: Brand positioning.

### REASONING FRAMEWORK:
When addressing complex queries:
1. **Analyze**: Break down the question into key components
2. **Research**: Consider relevant data, trends, and best practices
3. **Synthesize**: Combine insights into coherent recommendations
4. **Validate**: Check recommendations against constraints and goals
5. **Present**: Deliver clear, actionable insights with explanations

### OPERATING RULES:
1. DESIGN: Use 'claude' design system from .gemini/design/ for UI.
2. PLANNING: For complex tasks, use 'draftPlan' before execution.
3. RULES: Follow 'GEMINI.md' ruthlessly. Update it after learning from mistakes.
4. TOOLS: Use 'loadSkill' for PM frameworks. Use 'delegateToSpecialist' for deep technical work.
5. DELEGATION: Spawn specialized sub-agents for Frontend, Backend, Code Review, LLM Engineering.
6. VOICE: Professional, helpful, strategic, and insightful.
7. FORMATTING: Use markdown for readability. Use bullet points, headings, and short paragraphs when presenting information.`;
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
          "Add a document, link, or important context to the agent's memory using the MemPalace structure.",
        inputSchema: z.object({
          content: z.string().describe("The text content or summary to store"),
          source: z.string().describe("The source URL or file name"),
          wing: z
            .string()
            .describe("The project or person this belongs to (e.g. Cbarrgs)"),
          room: z.string().describe("The topic (e.g. Social Growth, Releases)"),
          drawer: z
            .string()
            .optional()
            .describe("Specific category or file name")
        }),
        execute: async ({ content, source, wing, room, drawer }) => {
          this
            .sql`INSERT INTO knowledge_base (content, source, wing, room, drawer) VALUES (${content}, ${source}, ${wing}, ${room}, ${drawer || null})`;
          return `Knowledge stored in Palace [Wing: ${wing}, Room: ${room}] from ${source}`;
        }
      }),

      saveToDiary: tool({
        description:
          "Save an internal reflection or 'diary entry' for the agent's long-term memory.",
        inputSchema: z.object({
          entry: z.string().describe("The observation or event to record"),
          reflection: z
            .string()
            .describe("Your internal reasoning or strategic thought about it")
        }),
        execute: async ({ entry, reflection }) => {
          this
            .sql`INSERT INTO agent_diary (entry, reflection) VALUES (${entry}, ${reflection})`;
          return "Diary entry saved to the Palace.";
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
          switch (operator) {
            case "+":
              return (a + b).toString();
            case "-":
              return (a - b).toString();
            case "*":
              return (a * b).toString();
            case "/":
              return (a / b).toString();
            case "%":
              return (a % b).toString();
            default:
              return "Invalid operator";
          }
        }
      }),

      loadSkill: tool({
        description:
          "Load a professional PM framework/skill from the local skills marketplace (e.g. 'product-strategy', 'gtm-motions').",
        inputSchema: z.object({
          skillName: z.string().describe("The name of the skill directory")
        }),
        execute: async ({ skillName }) => {
          return `Skill '${skillName}' loaded into temporary awareness. I will now apply the ${skillName} framework to our current task.`;
        }
      }),

      loadDesignSystem: tool({
        description:
          "Load a professional design system from the local marketplace (e.g. 'stripe', 'linear', 'apple'). Use this to ensure UI and marketing assets match a world-class aesthetic.",
        inputSchema: z.object({
          brand: z.string().describe("The name of the brand design system")
        }),
        execute: async ({ brand }) => {
          return `Design System '${brand}' loaded. I will now adopt the ${brand} visual tokens, colors, and layout patterns for all UI generation and design-related tasks.`;
        }
      }),

      draftPlan: tool({
        description:
          "Draft a technical or strategic plan in PLAN.md before executing a complex task. This follows the 'Boris Pattern' of planning before implementation.",
        inputSchema: z.object({
          taskName: z.string().describe("The name of the task"),
          steps: z.array(z.string()).describe("List of steps to execute"),
          verification: z
            .array(z.string())
            .describe("How to verify each step works")
        }),
        execute: async ({ taskName, steps, verification }) => {
          const plan = `# Task Plan: ${taskName}\n\n## Steps\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n## Verification\n${verification.map((v) => `- [ ] ${v}`).join("\n")}`;
          // In a real agent, we might write to a file or just return the text.
          // Since we want to follow the Boris pattern, we return it to the agent's context.
          return `Plan drafted successfully:\n\n${plan}`;
        }
      }),

      delegateToSpecialist: tool({
        description:
          "Delegate a complex task to a specialized sub-agent (e.g. 'frontend-designer', 'backend-engineer', 'code-reviewer', 'llm-engineer').",
        inputSchema: z.object({
          specialist: z.enum([
            "frontend-designer",
            "backend-engineer",
            "code-reviewer",
            "llm-engineer"
          ]),
          task: z.string().describe("The specific task to perform")
        }),
        execute: async ({ specialist, task }) => {
          const systemPrompts = {
            "frontend-designer":
              "You are a Senior Frontend Engineer and UI/UX Designer. Focus on accessibility, responsive design, and pixel-perfect implementation of the 'DESIGN.md' system. Use React, Tailwind, and Kumo.",
            "backend-engineer":
              "You are a Senior Backend Engineer specializing in Cloudflare Workers and Durable Objects. Focus on SQL optimization, security, and scalable architecture.",
            "code-reviewer":
              "You are a Lead Code Reviewer. Focus on code quality, performance, linting (oxlint), and adherence to project conventions. Be critical and thorough.",
            "llm-engineer":
              "You are an AI/LLM Engineer. Focus on prompt engineering, agentic workflows, context window management, and improving the agent's reasoning capabilities."
          };

          const workersai = createWorkersAI({ binding: this.env.AI });
          const { text } = await generateText({
            model: workersai("@cf/openai/gpt-oss-120b"),
            system: systemPrompts[specialist],
            prompt: task
          });

          return `[Sub-Agent: ${specialist}] Result:\n\n${text}`;
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
      }),

      signup: tool({
        description: "Sign up a new user for the marketing agent.",
        inputSchema: z.object({
          email: z.string().email().describe("User email address"),
          name: z.string().describe("User name or nickname")
        }),
        execute: async ({ email, name }) => {
          const existing = [
            ...this.sql`SELECT id FROM users WHERE email = ${email}`
          ];
          if (existing.length > 0) {
            return `User ${email} already exists. Please use /login instead.`;
          }
          this.sql`INSERT INTO users (email, name) VALUES (${email}, ${name})`;
          return `Welcome ${name}! You've been signed up. Your session: ${email}`;
        }
      }),

      login: tool({
        description: "Login an existing user and start their session.",
        inputSchema: z.object({
          email: z.string().email().describe("User email address")
        }),
        execute: async ({ email }) => {
          const user = [
            ...this.sql`SELECT name FROM users WHERE email = ${email}`
          ];
          if (user.length === 0) {
            return `User not found. Please /signup first.`;
          }
          return `Welcome back ${user[0].name}! Ready to help with your marketing.`;
        }
      }),

      createGroupChat: tool({
        description: "Start a group chat with multiple users.",
        inputSchema: z.object({
          participants: z
            .array(z.string().email())
            .describe("List of participant emails")
        }),
        execute: async ({ participants }) => {
          const sessionId = `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          this
            .sql`INSERT INTO user_sessions (user_email, session_id, is_group, participants) VALUES (${participants[0]}, ${sessionId}, TRUE, ${participants.join(",")})`;
          return `Group chat created! Session: ${sessionId}\nParticipants: ${participants.join(", ")}`;
        }
      }),

      listMyChats: tool({
        description: "List all your chats and group chats.",
        inputSchema: z.object({}),
        execute: async () => {
          const chats = [
            ...this
              .sql`SELECT session_id, is_group, participants FROM user_sessions ORDER BY created_at DESC LIMIT 20`
          ];
          if (chats.length === 0)
            return "No chats yet. Login or create a group chat.";
          return chats
            .map(
              (c) =>
                `${c.is_group ? "[GROUP]" : "[1:1]"} ${c.session_id} - ${c.participants || "You"}`
            )
            .join("\n");
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
    const _userText = tgUpdate.message.text;

    const workersai = createWorkersAI({ binding: this.env.AI });
    const streamResult = streamText({
      model: workersai("@cf/nvidia/nemotron-3-120b-a12b", {
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

    const response = await streamResult.toUIMessageStreamResponse();
    const responseText = await response.text();

    await fetch(
      `https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: responseText })
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
      model: workersai("@cf/nvidia/nemotron-3-120b-a12b", {
        sessionAffinity: this.sessionAffinity
      }),
      system: this.getSystemPrompt(),
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      tools: this.getTools(),
      stopWhen: stepCountIs(15)
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

# GEMINI.md - Project Memory for Cbarrgs Marketing Agent

A strategic AI agent for the Cbarrgs music ecosystem. This file implements Boris Cherny's productivity tips for AI-assisted coding.

## Project Purpose

This project is a Cloudflare Workers-based AI marketing agent that:

- Serves as a strategic growth lead for the Cbarrgs music ecosystem
- Manages social media presence (Instagram, TikTok, Twitter/X)
- Executes GTM strategies for releases ("Pieces For You" EP)
- Builds viral growth loops (2.3k → 37k followers)
- Maintains persistent memory via MemPalace-style structured knowledge base

## Tech Stack

- **Frontend**: React 19, Tailwind 4, @cloudflare/kumo components
- **Backend**: Cloudflare Workers, Durable Objects, D1 SQL
- **AI**: Cloudflare Workers AI (@cf/openai/gpt-oss-120b)
- **Linting**: oxlint, oxfmt
- **Database**: D1 (SQLite on Cloudflare)

## Coding Standards

### TypeScript

- **Version**: TypeScript ( strict mode enabled)
- **Formatter**: oxfmt
- **Linter**: oxlint
- **Type hints**: Required for all functions
- **Naming**: camelCase for functions/variables, PascalCase for classes

### React/Frontend

- Use Kumo components from @cloudflare/kumo
- **IMPORTANT**: Do NOT use `className` on `<Text>` or `<Badge>` components. Use `<span>` or `<div>` wrapper instead.
- Follow "Cbarrgs Vibe" design (DESIGN.md)

### Backend/Workers

- Always use indexed columns (wing, room, timestamp) for SQL queries
- When adding knowledge, always categorize into Wing and Room
- For complex tasks, use `draftPlan` tool before execution
- Use `delegateToSpecialist` for deep technical work

## Common Workflows

### Development

```bash
# Local development
npx wrangler dev

# Deploy to Cloudflare
npx wrangler deploy

# Generate types after binding changes
npx wrangler types
```

### Code Quality

```bash
# Check all (lint, format, types)
npm run check
```

### Git Workflow

- Follow GitHub Flow (feature branches from main)
- Use Conventional Commits:
  - `feat:` new feature
  - `fix:` bug fix
  - `docs:` documentation
  - `refactor:` code refactoring
  - `style:` formatting, no code changes
  - `chore:` maintenance

## Key Files

| File              | Purpose                                                    |
| ----------------- | ---------------------------------------------------------- |
| `src/server.ts`   | Main agent logic, tools, database schema                   |
| `src/app.tsx`     | React frontend chat UI                                     |
| `DESIGN.md`       | Cbarrgs Vibe design tokens                                 |
| `.gemini/skills/` | PM framework skills (product-strategy, gtm-strategy, etc.) |
| `.gemini/design/` | Design systems marketplace (VoltAgent awesome-design-md)   |

## Core Tools

The agent has these tools available:

- `updateMarketingNews` - Update website news
- `searchWeb` - Web search
- `searchSocialStats` - Social media stats
- `scrapeWebsite` - Fetch URL content
- `addKnowledge` - Store in MemPalace (requires wing + room)
- `saveToDiary` - Agent reflections
- `saveContentIdea` / `listContentIdeas` - Content pipeline
- `generateSocialPost` - Format viral posts
- `loadSkill` - Load PM frameworks from `.gemini/skills/`
- `loadDesignSystem` - Load design tokens from `.gemini/design/`
- `draftPlan` - Plan complex tasks before execution
- `delegateToSpecialist` - Spawn sub-agents (frontend-designer, backend-engineer, code-reviewer, llm-engineer)

## Known Pitfalls

<!-- Add corrections here as you encounter issues -->

1. **Kumo Text Components**: Never use `className` on `<Text>`, `<Badge>`, or similar Kumo components. Wrap with `<span>` or `<div>` instead.

2. **SQL Performance**: Always filter by indexed columns (wing, room, timestamp). Full table scans are slow on D1.

3. **MemPalace Structure**: When using `addKnowledge`, always specify `wing` and `room`. Without categorization, knowledge becomes unretrievable.

4. **Context Window**: The agent limits to 100 persisted messages. Use `pruneMessages` to manage token usage.

## Skills (from .gemini/skills/)

The agent has access to these PM frameworks:

- `marketing-ideas` - Creative cost-effective growth
- `gtm-strategy` - Launch execution
- `growth-loops` - Scalable follower acquisition
- `value-proposition` - Brand positioning
- `product-strategy` - Strategic planning
- `market-sizing` - TAM analysis
- `user-stories` - Requirements gathering
- And 60+ more in `.gemini/skills/`

## Design Systems (from awesome-design-md collection)

The agent has access to **50+ professional DESIGN.md files** from the awesome-design-md collection. Use `loadDesignSystem` to adopt any of these brand aesthetics:

### AI & LLM Platforms

- `claude` - Anthropic's AI assistant (warm terracotta, clean editorial)
- `elevenlabs` - AI voice (dark cinematic, audio-waveform)
- `opencode.ai` - AI coding (developer-centric dark)
- `voltagent` - AI agent framework (void-black, emerald accent)
- `ollama` - Run LLMs locally (terminal-first, monochrome)

### Developer Tools

- `cursor` - AI-first code editor (dark, gradient accents)
- `raycast` - Productivity launcher (chrome, vibrant gradients)
- `vercel` - Frontend deployment (black/white precision, Geist font)
- `expo` - React Native (dark, code-centric)

### Backend & Database

- `supabase` - Open-source Firebase (dark emerald, code-first)
- `mongodb` - Document database (green leaf, developer docs)
- `clickhouse` - Analytics DB (yellow-accented, technical)
- `posthog` - Product analytics (playful hedgehog, dark)

### Productivity & SaaS

- `linear` - Project management (ultra-minimal, purple accent)
- `notion` - All-in-one workspace (warm minimalism, serif headings)
- `resend` - Email API (minimal dark, monospace)
- `cal.com` - Scheduling (clean neutral)

### Design & Creative

- `figma` - Collaborative design (vibrant multi-color)
- `framer` - Website builder (bold black/blue, motion-first)

### Fintech & Crypto

- `stripe` - Payment infrastructure (signature purple gradients)
- `coinbase` - Crypto exchange (clean blue, trust-focused)
- `kraken` - Trading platform (purple-accented dark)

### Media & Consumer Tech

- `apple` - Consumer electronics (premium white space, SF Pro)
- `spotify` - Music streaming (vibrant green on dark)
- `nvidia` - GPU computing (green-black energy)

### E-commerce & Retail

- `shopify` - E-commerce (dark-first cinematic, neon green)
- `nike` - Athletic retail (monochrome, Futura)
- `airbnb` - Travel marketplace (warm coral, photography-driven)

### Automotive

- `tesla` - Electric vehicles (radical subtraction, cinematic)
- `bmw` - Luxury automotive (dark premium, German precision)
- `ferrari` - Luxury automotive (editorial, Ferrari Red)

For all 50+ designs, see the `.gemini/design/` directory or use `loadDesignSystem` with any brand name.

## Sub-Agents

Use `delegateToSpecialist` to spawn specialized sub-agents:

- `frontend-designer` - UI/UX, accessibility, responsive design
- `backend-engineer` - Database migrations, API logic
- `code-reviewer` - Quality, linting, conventions
- `llm-engineer` - Prompt engineering, agentic workflows

## Verification

Before completing any task:

1. Run `npm run check` - Verify lint, format, types
2. For frontend changes: Test in browser
3. For backend changes: Test via `npx wrangler dev`
4. Verify git diff shows intended changes

## Best Practices (Boris Cherny Method)

1. **Plan First**: For complex tasks, use `draftPlan` before execution. A good plan lets you one-shot the implementation.

2. **Work in Parallel**: Run multiple sessions on different tasks when possible.

3. **Create Skills for Repeated Workflows**: If you do something more than once, make it a skill.

4. **Give Verification Methods**: Always run tests, linters, or manual checks to verify work.

5. **Update This File**: After every mistake, update GEMINI.md so you don't make it again:
   > "Update GEMINI.md so you don't make that mistake again"

---

_This file is the project memory. Update it whenever you make a mistake._

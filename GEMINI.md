# GEMINI.md - Project Rules & Norms

This file is a living set of rules and project norms for the Cbarrgs Marketing Agent. Gemini should follow these ruthlessly.

## Tech Stack

- **Frontend**: React 19, Tailwind 4, @cloudflare/kumo components.
- **Backend**: Cloudflare Workers, Durable Objects, D1 SQL.
- **AI**: Cloudflare Workers AI, @cloudflare/ai-chat.
- **Linting**: oxlint, oxfmt.

## Project Norms

- **Aesthetics**: Follow the "Cbarrgs Vibe" (Spotify cinematic dark + Linear precision).
- **Design System**: Refer to `DESIGN.md` for visual tokens.
- **Skills**: Prioritize loading professional PM frameworks from `.gemini/skills`.
- **Specialists**: Delegate complex technical tasks to specialized sub-agents via `delegateToSpecialist`.

## Common Mistakes to Avoid

- **Kumo Text**: Do NOT use `className` on the `<Text>` component. Use a `<span>` or `<div>` wrapper instead.
- **SQL Queries**: Always use indexed columns (`wing`, `room`, `timestamp`) for performance.
- **Memory**: When adding knowledge, always categorize it into a Wing and Room.

## Sub-Agent Workflows

- **Frontend**: Use `frontend-designer` for UI/UX reviews.
- **Backend**: Use `backend-engineer` for database migrations and API logic.
- **Quality**: Use `code-reviewer` before any major commit.

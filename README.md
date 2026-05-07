# Multi-Agent Platform

A web platform where specialized AI agents handle role-based work for a small dev team. First two agents: a Project Manager and a Marketing assistant. Powered by **MiniMax M2.7** in production via its Anthropic-compatible API; provider-agnostic abstraction means other LLMs can plug in.

> **Note for AI build assistants (Claude Code, etc.):** Read `CLAUDE.md` first. Then `SPEC.md`, then `BUILD_PLAN.md`. Build one PR at a time.

## Stack

Next.js 14 (App Router, TypeScript) · Tailwind + shadcn/ui · PostgreSQL + Drizzle · Auth.js v5 · Vitest · pnpm

## Local dev setup

Prerequisites: Node 20, pnpm 9, Docker.

```bash
pnpm install
docker compose up -d              # starts Postgres on :5432
cp .env.example .env.local        # fill in DATABASE_URL and AUTH_SECRET
pnpm db:push                      # apply schema
pnpm db:seed                      # seed agents from prompts/*.md
pnpm dev                          # http://localhost:3000
```

The default `LLM_PROVIDER=mock` means the app works fully without a MiniMax key. To use the real model, set `LLM_PROVIDER=minimax` and `MINIMAX_API_KEY=...` in `.env.local` and restart.

Magic-link sign-in: in dev with no `AUTH_EMAIL_FROM` set, the magic link is printed to the server console — copy it from the terminal to sign in.

## Scripts

```
pnpm dev               # start dev server
pnpm build             # production build
pnpm start             # run production build
pnpm test              # vitest (unit; integration auto-skips without a DB)
pnpm test:integration  # vitest, integration suite (needs Postgres)
pnpm test:e2e          # playwright smoke test (needs built app + Postgres)
pnpm test:e2e:install  # download playwright browsers
pnpm lint              # eslint
pnpm typecheck         # tsc --noEmit
pnpm db:push           # apply Drizzle schema
pnpm db:seed           # seed agents
pnpm db:studio         # drizzle studio
```

The integration suite runs against the Postgres connection in
`INTEGRATION_DATABASE_URL` (defaults to `DATABASE_URL`). When unset, integration
tests are skipped and the unit suite runs alone.

The e2e smoke test boots the production server (`next start`) and uses the
Postgres pointed at by `DATABASE_URL`. It signs in by reading the magic-link
token directly from `verification_tokens` rather than scraping email.

## Project layout

```
src/
  app/            Next.js routes (pages + API)
  components/     UI components
  db/             Drizzle schema + client
  lib/
    llm/          provider-agnostic LLM abstraction
    agents/       agent runtime + tool registry
    auth.ts       Auth.js config
    env.ts        validated env access
  seed/           DB seeders
prompts/          agent system prompts (markdown)
tests/            unit + integration tests
```

## Adding a new agent

1. Add a markdown system prompt at `prompts/<slug>.md`.
2. Add a row to the seed in `src/seed/agents.ts`.
3. Run `pnpm db:seed`.
4. The agent appears in the sidebar.

No code changes needed.

## Switching the LLM provider

Set `LLM_PROVIDER` in `.env.local`:

- `mock` — built-in fake provider, used in tests and dev with no keys
- `minimax` — MiniMax M2.7 via their Anthropic-compatible endpoint (requires `MINIMAX_API_KEY`)

To add a new provider (e.g. direct Anthropic, OpenAI), implement the `LLMProvider` interface in `src/lib/llm/types.ts`, drop it in `src/lib/llm/providers/`, and wire it into the factory in `src/lib/llm/index.ts`.

## Important: MiniMax M2.7 thinking blocks

M2.7 produces interleaved `<think>...</think>` blocks. They are persisted on assistant messages (column `messages.thinking`) and **must be re-sent in the conversation history on follow-up turns**. Stripping them degrades quality. The MiniMax provider in `src/lib/llm/providers/minimax.ts` handles this; do not bypass it.

## License

TBD.

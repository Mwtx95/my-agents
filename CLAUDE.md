# Instructions for Claude Code

You are building a multi-agent web platform for a small dev company. Read these files in order before writing any code:

1. `SPEC.md` — full specification (architecture, schema, routes, requirements)
2. `BUILD_PLAN.md` — staged PR plan; you build ONE PR at a time
3. `prompts/pm-agent.md` and `prompts/marketing-agent.md` — agent configurations
4. `.env.example` — environment variables

## Working agreement

- Implement only the scope of the PR you're asked to do, from `BUILD_PLAN.md`. Do not pull features from later PRs.
- If anything is ambiguous, list questions in the PR description. Do not guess silently.
- Any decision you make beyond what the spec dictates must be documented in the PR description under a "Decisions made" section.
- Tests must pass without any third-party API keys configured. Use the mock LLM provider for tests.
- Never put the MiniMax API key (or any secret) in client-side code. Server-only, via environment variable.
- The MiniMax key will be added to `.env.local` after the full stack is complete. Until then, the app must run locally using the mock LLM provider.

## Critical: MiniMax M2.7 specifics

MiniMax M2.7 is an interleaved-thinking model. When the model generates a response, it produces `<think>...</think>` blocks before the final answer.

- These thinking blocks **must be persisted** with the assistant message in the database.
- They **must be sent back** as part of the conversation history on the next turn.
- Removing or stripping them degrades the model's quality on follow-up turns.
- See `lib/llm/providers/minimax.ts` (which you will create) and the official docs: https://platform.minimax.io/docs

MiniMax exposes an Anthropic-compatible API endpoint, so the provider implementation should use the official `@anthropic-ai/sdk` package with a custom `baseURL`. Do not write a hand-rolled HTTP client.

## What "done" looks like for any PR

- Code compiles, lints clean, type-checks
- All tests pass (`pnpm test`)
- README or relevant docs updated
- PR description includes: scope summary, decisions made, deliberate stubs, and any open questions
- The app boots locally with `pnpm dev` against the mock LLM provider

## How to open the PR

- Branch name: `pr-NN-short-description` (e.g. `pr-01-foundation`)
- Commit messages: conventional commits (`feat:`, `chore:`, `fix:`, `test:`, `docs:`)
- Draft PR is fine — mark ready for review when all checks pass
- Title: `PR NN — <PR title from BUILD_PLAN.md>`

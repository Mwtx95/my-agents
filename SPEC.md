# Multi-Agent Platform — Specification

## 1. Overview

A web application that lets a small dev team chat with role-specialized AI agents from a single interface. First two agents:

- **PM Agent** — project management tasks (ticket triage, status digests, sprint planning, action items, meeting notes)
- **Marketing Agent** — marketing tasks (content drafting, copy review, headline generation, marketing plan outlines)

All agents are powered by **MiniMax M2.7** in production, accessed via MiniMax's Anthropic-compatible API endpoint. A provider-agnostic abstraction sits in front, so other LLMs (Claude direct, OpenAI, etc.) can plug in by swapping a config value.

## 2. Goals

- A single signed-in user can chat with multiple specialized agents.
- Each agent has its own system prompt, optional toolset, and conversation history.
- Conversations persist across sessions.
- Responses stream to the UI as they're generated (token-by-token feel).
- Adding a new agent = adding a config row in the database. No new code paths.
- The whole stack runs locally for development without any third-party API keys.

## 3. Non-goals (explicitly out of scope for v1)

- Multi-tenant teams / organizations (single-user-per-account is fine for now).
- Billing or subscriptions.
- The marketing agent's external send integrations (no posting to social, no email send). Drafting only.
- Mobile native apps.
- Real-time collaboration (multiple humans in same conversation).
- Voice / audio input or output.
- File uploads (text-only chat for v1).

## 4. Tech stack — locked

Do not substitute components without documenting and asking first.

| Layer | Choice |
|-------|--------|
| Framework | Next.js 14 (App Router, TypeScript, `strict: true`) |
| Styling | Tailwind CSS + shadcn/ui components |
| Database | PostgreSQL (Supabase managed for prod; local Docker Compose for dev) |
| ORM | Drizzle ORM with `drizzle-kit` for migrations |
| Auth | Auth.js (NextAuth v5) — email magic link provider |
| Validation | Zod (input validation on all API routes) |
| Testing | Vitest + React Testing Library + Playwright (e2e — only smoke test in PR 1) |
| Streaming | Server-Sent Events (SSE) |
| Background jobs | Inngest (deferred to PR 5; do not install before then) |
| LLM SDK | `@anthropic-ai/sdk` (works with MiniMax via custom `baseURL`) |
| Linter | ESLint (Next.js config) + Prettier |
| Package manager | pnpm (commit `pnpm-lock.yaml`) |
| Node | v20 LTS (specify in `.nvmrc` and `engines`) |

## 5. Project structure

```
.
├── CLAUDE.md
├── SPEC.md
├── BUILD_PLAN.md
├── README.md
├── .env.example
├── .nvmrc
├── docker-compose.yml          # local Postgres
├── drizzle.config.ts
├── next.config.mjs
├── package.json
├── tailwind.config.ts
├── tsconfig.json
├── vitest.config.ts
├── prompts/
│   ├── pm-agent.md
│   └── marketing-agent.md
├── src/
│   ├── app/
│   │   ├── (auth)/             # sign-in pages
│   │   ├── (app)/              # authenticated app shell
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx        # redirect to default agent
│   │   │   └── [agentSlug]/
│   │   │       ├── page.tsx
│   │   │       └── [conversationId]/page.tsx
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts
│   │   │   ├── agents/route.ts
│   │   │   ├── conversations/route.ts
│   │   │   ├── conversations/[id]/route.ts
│   │   │   ├── chat/[agentSlug]/route.ts   # SSE
│   │   │   └── health/route.ts
│   │   └── layout.tsx
│   ├── components/
│   │   ├── ui/                 # shadcn primitives
│   │   ├── chat/
│   │   └── sidebar/
│   ├── db/
│   │   ├── index.ts            # drizzle client
│   │   ├── schema.ts
│   │   └── migrations/
│   ├── lib/
│   │   ├── auth.ts
│   │   ├── env.ts              # zod-validated env access
│   │   ├── llm/
│   │   │   ├── types.ts        # provider interface
│   │   │   ├── index.ts        # provider factory (reads env)
│   │   │   └── providers/
│   │   │       ├── minimax.ts
│   │   │       └── mock.ts
│   │   ├── agents/
│   │   │   ├── runtime.ts      # the run loop
│   │   │   └── tools/          # tool implementations (PR 4+)
│   │   └── logger.ts
│   ├── seed/
│   │   └── agents.ts           # seeds PM + Marketing agents
│   └── types/
└── tests/
    ├── unit/
    └── integration/
```

## 6. Data model

All tables use `bigserial` PKs unless noted. Timestamps are `timestamptz` with `default now()`. Use Drizzle's snake_case naming.

```ts
// users — managed by Auth.js (standard Auth.js Drizzle adapter tables)
// accounts, sessions, verification_tokens — also Auth.js standard

// agents
{
  id: bigserial PK
  slug: text UNIQUE NOT NULL          // 'pm', 'marketing'
  name: text NOT NULL                  // 'Project Manager'
  description: text
  system_prompt: text NOT NULL         // loaded from prompts/*.md at seed time
  model: text NOT NULL DEFAULT 'MiniMax-M2.7'
  temperature: real NOT NULL DEFAULT 1.0
  max_tokens: integer NOT NULL DEFAULT 4096
  enabled: boolean NOT NULL DEFAULT true
  created_at, updated_at
}

// conversations
{
  id: bigserial PK
  user_id: FK -> users.id ON DELETE CASCADE
  agent_id: FK -> agents.id ON DELETE RESTRICT
  title: text                          // auto-generated from first user message
  archived: boolean NOT NULL DEFAULT false
  created_at, updated_at
  INDEX (user_id, agent_id, updated_at DESC)
}

// messages
{
  id: bigserial PK
  conversation_id: FK -> conversations.id ON DELETE CASCADE
  role: text NOT NULL                  // 'user' | 'assistant' | 'tool' | 'system'
  content: text NOT NULL
  thinking: text                       // MiniMax M2.7 <think> content; nullable
  tool_calls: jsonb                    // assistant message tool calls; nullable
  tool_call_id: text                   // for role='tool' messages; nullable
  model: text                          // model that produced assistant messages
  created_at
  INDEX (conversation_id, created_at)
}

// agent_runs — one row per LLM invocation, for observability
{
  id: bigserial PK
  conversation_id: FK -> conversations.id ON DELETE CASCADE
  user_id: FK -> users.id
  agent_id: FK -> agents.id
  input_messages: jsonb NOT NULL       // snapshot of messages sent to model
  output: jsonb                        // final assistant message + tool calls
  tool_calls_count: integer NOT NULL DEFAULT 0
  tokens_input: integer
  tokens_output: integer
  duration_ms: integer
  status: text NOT NULL                // 'success' | 'error' | 'max_iterations'
  error: text
  created_at
  INDEX (user_id, created_at DESC)
}

// integrations — for tools (PR 4+)
{
  id: bigserial PK
  user_id: FK -> users.id ON DELETE CASCADE
  provider: text NOT NULL              // 'github', 'slack', etc.
  access_token_encrypted: text NOT NULL
  refresh_token_encrypted: text
  expires_at: timestamptz
  metadata: jsonb                      // provider-specific
  created_at, updated_at
  UNIQUE (user_id, provider)
}
```

Encryption note for `integrations`: use `node:crypto` AES-256-GCM with a key from env var `ENCRYPTION_KEY`. Helper in `src/lib/crypto.ts`. (Implement in PR 4 when first integration is added.)

## 7. LLM abstraction

The whole point: code outside `src/lib/llm/` never imports the Anthropic SDK or MiniMax-specific anything. It only uses the `LLMProvider` interface.

```ts
// src/lib/llm/types.ts

export type LLMRole = 'system' | 'user' | 'assistant' | 'tool'

export interface LLMMessage {
  role: LLMRole
  content: string
  thinking?: string                // assistant only — preserved across turns
  toolCalls?: LLMToolCall[]
  toolCallId?: string              // tool messages only
}

export interface LLMToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface LLMTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>  // JSON Schema
}

export interface LLMUsage {
  inputTokens: number
  outputTokens: number
}

export type LLMStreamChunk =
  | { type: 'thinking_delta'; delta: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; toolCall: LLMToolCall }
  | { type: 'message_done'; usage: LLMUsage; stopReason: string }
  | { type: 'error'; error: string }

export interface LLMChatOptions {
  systemPrompt: string
  messages: LLMMessage[]
  tools?: LLMTool[]
  temperature?: number
  maxTokens?: number
}

export interface LLMProvider {
  readonly name: string
  chat(options: LLMChatOptions): AsyncIterable<LLMStreamChunk>
}
```

### Provider factory

`src/lib/llm/index.ts` exports `getLLMProvider(): LLMProvider`. It reads env var `LLM_PROVIDER` (one of `minimax` | `mock`) and returns the matching provider. Default in dev is `mock`. In tests, always `mock`.

### MiniMax provider

`src/lib/llm/providers/minimax.ts` uses `@anthropic-ai/sdk` with `baseURL` pointing to MiniMax's Anthropic-compatible endpoint. Reads `MINIMAX_API_KEY` and `MINIMAX_BASE_URL` from env. The provider must:

1. Translate `LLMMessage[]` to the SDK's expected shape, **including reconstructing `<think>...</think>` blocks** from the `thinking` field on the assistant messages, prepending them to that message's `content`.
2. Stream the response and emit `thinking_delta` chunks while inside `<think>` tags and `text_delta` chunks otherwise. (Parse the stream as it arrives.)
3. Emit `tool_call` chunks when the SDK reports tool use blocks.
4. Emit a final `message_done` chunk with usage.

### Mock provider

`src/lib/llm/providers/mock.ts` is the default for dev/test. It produces a canned streamed response based on the last user message. Examples it should handle deterministically:

- If user message contains "error", emit an `error` chunk.
- If user message contains "tool", emit a synthetic `tool_call` chunk (e.g. for an `echo` tool).
- Otherwise stream a short canned reply with a synthetic `<think>` block first, character by character with a 5–15ms delay between characters, so streaming is observable in the UI.

## 8. API routes

All routes live under `src/app/api/`. All authenticated routes must verify the Auth.js session and 401 if absent.

### `POST /api/chat/[agentSlug]`

Body (Zod):
```ts
{
  conversationId: number | null,   // null = create new
  message: string                  // user's message
}
```

Behavior:
1. Auth check.
2. Load agent by slug; 404 if not found.
3. If `conversationId` is null, create a new conversation owned by the user, scoped to the agent. Auto-generate title from the first 60 chars of the user message.
4. Persist the user message.
5. Load the full message history for the conversation, ordered by `created_at`.
6. Build LLM messages array (including `thinking` on assistant messages).
7. Call `getLLMProvider().chat(...)` with the agent's system prompt and tools (tools = empty for v1; PR 4 adds them).
8. Stream chunks back to the client as SSE events.
9. As the stream completes, persist the assistant message (with separated `thinking` and `content`), and write an `agent_runs` row.
10. Send a final SSE event `{ type: 'done', conversationId, messageId }`.

SSE event format:
```
event: chunk
data: {"type":"text_delta","delta":"Hello"}

event: chunk
data: {"type":"thinking_delta","delta":"Let me consider..."}

event: done
data: {"conversationId":42,"messageId":107}
```

Hard cap: max 15 model iterations per request (for tool-call loops in PR 4). Beyond that, persist with `status='max_iterations'` and end the stream with an error event.

### `GET /api/conversations`
Returns the user's conversations, newest first. Optional query: `?agentSlug=pm`.

### `GET /api/conversations/[id]`
Returns the conversation with all messages. 403 if not owned by the user.

### `DELETE /api/conversations/[id]`
Soft-delete: sets `archived = true`. Hard-delete is admin-only (out of scope).

### `GET /api/agents`
Returns enabled agents.

### `GET /api/health`
Returns `{ status: 'ok', db: 'ok' | 'error', llm: 'ok' | 'error' }`. Performs a 1-row `SELECT` on `agents` and a 1-token call to the LLM provider. Used by CI smoke test.

### `POST /api/auth/[...nextauth]`
Auth.js handler. Magic link via Resend or SMTP (configurable; for dev, log link to console).

## 9. Streaming on the client

The chat page uses the browser's native `EventSource` is not enough because we need POST. Use `fetch` with a `ReadableStream` reader and parse SSE manually, or use the `eventsource-parser` package. Render thinking and text deltas into separate UI regions:

- Thinking shown in a collapsible "Thoughts" pane above the assistant bubble, dimmed.
- Text streamed into the assistant bubble.
- Tool calls render as inline cards inside the assistant message.

## 10. Auth model

- Auth.js (NextAuth v5) with the email provider.
- Drizzle adapter for sessions/users/accounts tables.
- For local dev, magic links are written to the server console — no SMTP required.
- Seed creates a default agent set; first sign-in does not auto-create agents (seed handles it).

## 11. Agent runtime — the run loop

Lives in `src/lib/agents/runtime.ts`. Pseudocode:

```
function runAgent({ agent, conversationId, userMessage, userId }):
  persist user message
  history = load messages for conversation
  llmMessages = toLLMMessages(history, includeThinking=true)
  tools = await loadToolsForAgent(agent.id)   // empty for v1

  iterations = 0
  while iterations < MAX_ITERATIONS:
    iterations++
    chunks = provider.chat({ systemPrompt, messages: llmMessages, tools })
    for chunk in chunks:
      yield chunk
      accumulate chunk into assistantMsg

    if assistantMsg has toolCalls and tools available:
      persist assistant message
      for each toolCall:
        toolResult = await runTool(toolCall, userId)
        persist tool message
        llmMessages.push(assistantMsg, toolMessage)
      continue   // loop again with tool results
    else:
      persist assistant message
      yield { type: 'done', ... }
      break

  if iterations === MAX_ITERATIONS:
    persist agent_run with status='max_iterations'
    yield { type: 'error', error: 'Max iterations reached' }
```

`MAX_ITERATIONS = 15`. Constant in `src/lib/agents/runtime.ts`.

## 12. Tool calling architecture (defined now, implemented PR 4+)

A tool is an object:

```ts
export interface Tool {
  name: string
  description: string
  inputSchema: ZodSchema           // converted to JSON Schema for the LLM
  requiresIntegration?: 'github' | 'slack' | ...
  execute(input: unknown, ctx: { userId: number }): Promise<unknown>
}
```

Tools register themselves in `src/lib/agents/tools/registry.ts`. Agents declare their tool list in seed data (config table linking agent → tool name; spec out in PR 4).

## 13. Error handling

- All API routes wrap handlers in a `withErrorHandler` helper that catches, logs, and returns a structured JSON error.
- LLM provider errors stream as `{ type: 'error', error: '...' }` and the client renders a red banner inline in the conversation.
- DB errors → 500 with generic message; full error in server logs.
- Auth errors → 401.
- Validation errors → 400 with details (only field paths, not values).

## 14. Logging

`src/lib/logger.ts` exports a `pino` logger. Log levels: `debug`, `info`, `warn`, `error`. In dev, pretty-print. In prod, JSON to stdout.

Every agent run logs at `info`: agent slug, user id, conversation id, message length, duration, tool call count, status. Never log message content at `info`. Content goes only to `debug`.

## 15. Testing requirements

- Unit tests for the LLM abstraction (mock provider produces correct chunk types).
- Unit tests for the agent runtime (run loop terminates, tool calls dispatch correctly with stub tools).
- Integration test for `POST /api/chat/[agentSlug]` using the mock provider. Verifies persistence and SSE output.
- Smoke e2e test (Playwright): sign in → send a message → see streamed response. (PR 2.)
- All tests run in CI without a MiniMax key. The mock provider is the default in test env.

## 16. Environment variables

See `.env.example` for the full list. Validate at startup with Zod in `src/lib/env.ts`. The app refuses to boot if required vars are missing.

## 17. Local dev setup

`README.md` will document this. Briefly:

```
pnpm install
docker compose up -d            # starts Postgres on :5432
cp .env.example .env.local      # fill in only DATABASE_URL and AUTH_SECRET
pnpm db:push                    # applies Drizzle schema
pnpm db:seed                    # seeds agents
pnpm dev
```

The mock LLM provider is the default. To switch to MiniMax, set `LLM_PROVIDER=minimax` and `MINIMAX_API_KEY=...` in `.env.local` and restart.

## 18. Deferred decisions

These are intentionally NOT decided in this spec. When the time comes (PR 4+), open a discussion in the PR description rather than guessing:

- Tool approval UX (auto-execute vs. confirm-each-call vs. confirm-write-only).
- Title regeneration policy (when to update conversation title).
- Conversation summarization for long threads.
- Rate limiting per user.
- Production hosting (Vercel? Railway? Fly?).

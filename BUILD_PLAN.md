# Build Plan — Staged PRs

Build the platform as a sequence of small, reviewable PRs. Each PR has a tightly defined scope and acceptance criteria. Do not pull features from later PRs into earlier ones. If you find yourself wanting to, stop and add a note in the PR description instead.

---

## PR 1 — Foundation

**Goal:** A repo that boots, has the database wired up, has auth working, has the LLM abstraction in place with a working mock provider, and has CI passing.

**In scope:**
- Next.js 14 App Router scaffold with TypeScript strict mode, Tailwind, shadcn/ui initialized.
- `docker-compose.yml` for local Postgres.
- Drizzle ORM setup, schema for all tables in `SPEC.md` section 6 (yes, all of them — they're cheap to create now).
- `pnpm db:push` and `pnpm db:seed` scripts. Seed reads `prompts/pm-agent.md` and `prompts/marketing-agent.md` and inserts the two agents.
- Auth.js v5 with email provider; magic links logged to console in dev.
- LLM abstraction: `src/lib/llm/types.ts`, `src/lib/llm/index.ts` (factory), `src/lib/llm/providers/mock.ts`. The MiniMax provider can be a stub that throws "not implemented" — full implementation is PR 2.
- Wait — adjust: include the MiniMax provider in PR 1 too, so adding the API key later is the only remaining step. Use `@anthropic-ai/sdk` with custom `baseURL`. It does not need to be exercised by tests.
- `GET /api/health` route.
- `src/lib/env.ts` Zod-validated env access.
- `src/lib/logger.ts` pino logger.
- ESLint + Prettier configs.
- GitHub Actions CI: install, lint, typecheck, test.
- Tests: unit tests for the mock provider and env validation.
- `README.md` with local dev setup instructions.

**Out of scope (do not build):**
- Any UI beyond the default Next.js landing page redirecting to `/sign-in`.
- The chat endpoint.
- Tool calling.
- Background jobs.

**Acceptance criteria:**
- `pnpm install && pnpm dev` boots the app on `localhost:3000`.
- `pnpm test` passes with no API keys set.
- `GET /api/health` returns `{ status: 'ok', db: 'ok', llm: 'ok' }` (mock LLM is "ok" by default).
- `pnpm db:push && pnpm db:seed` populates the `agents` table with two rows.

---

## PR 2 — Single-agent chat with streaming

**Goal:** A user can sign in, land on the PM agent's page, send a message, and watch the response stream in.

**In scope:**
- Sign-in page (`/(auth)/sign-in`) using Auth.js email provider.
- Authenticated app shell (`/(app)/layout.tsx`) with a sidebar showing conversations (PM agent only for now) and a main chat panel.
- Route `/(app)/[agentSlug]/page.tsx` that creates a new empty conversation view.
- Route `/(app)/[agentSlug]/[conversationId]/page.tsx` that loads an existing conversation.
- `POST /api/chat/[agentSlug]` SSE endpoint, exactly as specified in `SPEC.md` section 8.
- `GET /api/conversations` and `GET /api/conversations/[id]` routes.
- The chat client component: send message → open SSE → render `thinking_delta` into a collapsible "Thoughts" region, render `text_delta` into the message bubble.
- `src/lib/agents/runtime.ts` with the run loop (without tool calling — that's PR 4, but the loop structure should be there with `MAX_ITERATIONS` enforced).
- Persist user messages, assistant messages (with `thinking` separated), and `agent_runs` rows.
- Conversation auto-titling from the first user message.
- Integration test: `POST /api/chat/pm` with mock provider returns the expected stream and persists messages.
- Playwright smoke test: sign in → send message → assert streamed response appears.

**Out of scope:**
- Marketing agent UI (only PM is visible in the sidebar).
- Tool calling.
- Editing or regenerating messages.
- Markdown rendering inside messages — plain text is fine for now (defer to PR 3).

**Acceptance criteria:**
- Manual: sign in, send "hello", see a streamed mock response with a Thoughts pane.
- The `messages` table contains both the user and assistant rows after the response completes.
- The assistant message has non-null `thinking` (because the mock emits it).
- Refreshing the page shows the same conversation persisted.

---

## PR 3 — Multi-agent UI and markdown

**Goal:** User can switch between PM and Marketing agents from the sidebar. Each agent has its own conversation list. Assistant messages render markdown.

**In scope:**
- Sidebar shows agent switcher at the top (two pills: "PM" / "Marketing"). Clicking switches the visible conversation list.
- `/(app)/page.tsx` redirects to `/(app)/pm`.
- Markdown rendering for assistant messages using `react-markdown` + `remark-gfm`. Sanitize with `rehype-sanitize`. Code blocks get syntax highlighting via `shiki` or `rehype-pretty-code`.
- Thinking pane also renders markdown.
- Agent metadata (name, description, system prompt preview) shown in a small header above the chat.
- Per-agent conversation history endpoints already exist; just wire UI.

**Out of scope:**
- Tool calling.
- File attachments.
- Editing system prompts via UI (admin-only, deferred).

**Acceptance criteria:**
- Both PM and Marketing agents are usable from the UI.
- Switching agents preserves each one's history independently.
- Sending a message that contains a markdown table renders correctly.

---

## PR 4 — Tool calling and the first integration

**Goal:** PM agent can read GitHub issues and PRs via tool calls. The run loop handles tool calls and feeds results back to the model. The Marketing agent has at least one stub tool to demonstrate per-agent toolset config.

**In scope:**
- Tool registry (`src/lib/agents/tools/registry.ts`) and `Tool` interface from `SPEC.md` section 12.
- Tool calling support in the LLM abstraction: `tools` array in `LLMChatOptions`, `tool_call` chunks in the stream, `tool` role messages.
- Tool calling support in the mock provider (existing test path) and the MiniMax provider (real implementation).
- Run loop in `runtime.ts` handles tool calls: dispatch, persist as `role='tool'` message, loop again with results, respect `MAX_ITERATIONS`.
- `agent_tools` table linking agents to enabled tool names. Seed wires PM agent → GitHub tools.
- GitHub OAuth integration: connect from a `/settings/integrations` page, store encrypted tokens in `integrations` table.
- GitHub tools: `github_list_issues`, `github_list_prs`, `github_get_issue`. Read-only.
- AES-256-GCM encryption helper for integration tokens (`src/lib/crypto.ts`).
- UI: tool calls render as inline cards inside the assistant message showing name, input, and (collapsible) result.
- Tool approval mode: a per-agent setting `tool_approval` enum ('auto' | 'confirm'). Default 'auto' for read-only tools. UI for confirm mode is a button that resumes the run.

**Out of scope:**
- Write tools (creating issues, commenting). Read-only for now.
- Slack, Linear, Jira, calendar integrations.
- Marketing agent's real tools — give it one stub tool that just echoes input.

**Acceptance criteria:**
- A user can connect their GitHub account from settings.
- "Show me open issues" to the PM agent triggers `github_list_issues` and produces a real summary.
- The tool call and result are visible in the message thread and persisted.
- `agent_runs.tool_calls_count` is correct.
- If the user disconnects GitHub, the tool returns a clear error message that the agent can speak to.

---

## PR 5 — Scheduled runs and digests

**Goal:** PM agent can produce a daily digest automatically and post it to a destination of the user's choice.

**In scope:**
- Inngest setup (cron + event-driven jobs).
- A scheduled job that, for each user with a configured digest, runs the PM agent against a hardcoded prompt template and stores the result as a regular conversation entry tagged `automated=true`.
- Per-user digest config: enabled, schedule (cron), destination (in-app for now; Slack/email later).
- A "Daily Digest" view in the sidebar showing past digests.

**Out of scope:**
- Multi-step orchestrated workflows.
- Email send, Slack post (in-app delivery only).

**Acceptance criteria:**
- A test scheduled run can be triggered manually from the UI ("Run now").
- The run produces a stored conversation entry with the agent's output.

---

## After PR 5

Open a planning issue listing what's worth doing next. Likely candidates: write tools (create GitHub issue, post to Slack draft), Linear integration, conversation summarization for long threads, an admin UI for editing system prompts. Don't build any of these speculatively.

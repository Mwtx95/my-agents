import { and, asc, eq } from 'drizzle-orm'

import { db } from '@/db'
import { agentRuns, conversations, messages, type Agent, type Message } from '@/db/schema'
import { getLLMProvider } from '@/lib/llm'
import type { LLMMessage, LLMStreamChunk, LLMTool, LLMToolCall, LLMUsage } from '@/lib/llm/types'
import { logger } from '@/lib/logger'

export const MAX_ITERATIONS = 15
const TITLE_MAX_LEN = 60

export interface RunAgentInput {
  agent: Agent
  userId: string
  conversationId: number | null
  userMessage: string
  /** Tools available to the agent. Empty for v1 — PR 4 wires real tools. */
  tools?: LLMTool[]
  signal?: AbortSignal
}

export type RuntimeChunk =
  | LLMStreamChunk
  | { type: 'conversation_created'; conversationId: number; title: string }
  | { type: 'done'; conversationId: number; messageId: number }

interface AssistantAccumulator {
  text: string
  thinking: string
  toolCalls: LLMToolCall[]
  usage: LLMUsage | null
  stopReason: string | null
  errored: boolean
  errorMessage: string | null
}

function emptyAccumulator(): AssistantAccumulator {
  return {
    text: '',
    thinking: '',
    toolCalls: [],
    usage: null,
    stopReason: null,
    errored: false,
    errorMessage: null,
  }
}

function autoTitle(message: string): string {
  const trimmed = message.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= TITLE_MAX_LEN) return trimmed
  return trimmed.slice(0, TITLE_MAX_LEN - 1).trimEnd() + '…'
}

function toLLMMessages(rows: Message[]): LLMMessage[] {
  return rows.map((row) => {
    const base: LLMMessage = {
      role: row.role,
      content: row.content,
    }
    if (row.role === 'assistant') {
      if (row.thinking) base.thinking = row.thinking
      if (row.toolCalls) base.toolCalls = row.toolCalls as LLMToolCall[]
    }
    if (row.role === 'tool' && row.toolCallId) {
      base.toolCallId = row.toolCallId
    }
    return base
  })
}

/**
 * Drives a single user → assistant turn. Persists the user message, streams
 * the assistant response, and writes one `agent_runs` row.
 *
 * Tool calling is supported by the loop structure (up to MAX_ITERATIONS), but
 * v1 callers pass `tools: []` so the loop runs exactly once.
 */
export async function* runAgent(input: RunAgentInput): AsyncGenerator<RuntimeChunk> {
  const { agent, userId, userMessage, tools = [], signal } = input
  const startedAt = Date.now()

  // 1. Resolve / create the conversation.
  let conversationId = input.conversationId
  let conversationTitle: string | null = null
  if (conversationId === null) {
    conversationTitle = autoTitle(userMessage)
    const [row] = await db
      .insert(conversations)
      .values({
        userId,
        agentId: agent.id,
        title: conversationTitle,
      })
      .returning({ id: conversations.id, title: conversations.title })
    if (!row) throw new Error('Failed to create conversation')
    conversationId = row.id
    yield { type: 'conversation_created', conversationId, title: row.title ?? conversationTitle }
  } else {
    // Ownership check happens at the API layer; defensive read here.
    const existing = await db.query.conversations.findFirst({
      where: and(eq(conversations.id, conversationId), eq(conversations.userId, userId)),
    })
    if (!existing) throw new Error(`Conversation ${conversationId} not found for user`)
  }

  // 2. Persist the user message.
  await db.insert(messages).values({
    conversationId,
    role: 'user',
    content: userMessage,
  })

  // 3. Build the LLM message history.
  const history = await db.query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
    orderBy: [asc(messages.createdAt), asc(messages.id)],
  })

  const llmMessages: LLMMessage[] = toLLMMessages(history)
  const provider = getLLMProvider()

  let lastAssistantMessageId: number | null = null
  let totalToolCalls = 0
  let lastUsage: LLMUsage | null = null
  let lastStopReason: string | null = null
  let runStatus: 'success' | 'error' | 'max_iterations' = 'success'
  let errorMessage: string | null = null

  let iteration = 0
  let snapshotMessages = llmMessages.slice()

  try {
    while (iteration < MAX_ITERATIONS) {
      iteration++
      const acc = emptyAccumulator()

      const stream = provider.chat({
        systemPrompt: agent.systemPrompt,
        messages: llmMessages,
        tools: tools.length > 0 ? tools : undefined,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        model: agent.model,
        signal,
      })

      for await (const chunk of stream) {
        switch (chunk.type) {
          case 'text_delta':
            acc.text += chunk.delta
            yield chunk
            break
          case 'thinking_delta':
            acc.thinking += chunk.delta
            yield chunk
            break
          case 'tool_call':
            acc.toolCalls.push(chunk.toolCall)
            yield chunk
            break
          case 'message_done':
            acc.usage = chunk.usage
            acc.stopReason = chunk.stopReason
            break
          case 'error':
            acc.errored = true
            acc.errorMessage = chunk.error
            yield chunk
            break
        }
      }

      lastUsage = acc.usage
      lastStopReason = acc.stopReason

      if (acc.errored) {
        runStatus = 'error'
        errorMessage = acc.errorMessage
        break
      }

      // Persist assistant message for this iteration.
      const [saved] = await db
        .insert(messages)
        .values({
          conversationId,
          role: 'assistant',
          content: acc.text,
          thinking: acc.thinking || null,
          toolCalls: acc.toolCalls.length > 0 ? acc.toolCalls : null,
          model: agent.model,
        })
        .returning({ id: messages.id })
      if (!saved) throw new Error('Failed to persist assistant message')
      lastAssistantMessageId = saved.id

      const assistantLLMMessage: LLMMessage = {
        role: 'assistant',
        content: acc.text,
        ...(acc.thinking ? { thinking: acc.thinking } : {}),
        ...(acc.toolCalls.length > 0 ? { toolCalls: acc.toolCalls } : {}),
      }
      llmMessages.push(assistantLLMMessage)
      snapshotMessages = llmMessages.slice()

      // No tool support yet — break out after a single iteration.
      if (acc.toolCalls.length === 0 || tools.length === 0) {
        break
      }

      // PR 4 will dispatch tool calls here, push role='tool' messages, and continue.
      totalToolCalls += acc.toolCalls.length
      break
    }

    if (iteration >= MAX_ITERATIONS && runStatus === 'success') {
      runStatus = 'max_iterations'
      errorMessage = 'Max iterations reached'
      yield { type: 'error', error: errorMessage }
    }
  } catch (err) {
    runStatus = 'error'
    errorMessage = err instanceof Error ? err.message : String(err)
    yield { type: 'error', error: errorMessage }
  }

  // Touch conversation.updated_at so the sidebar reorders correctly.
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))

  // Write the agent_runs row regardless of outcome.
  await db.insert(agentRuns).values({
    conversationId,
    userId,
    agentId: agent.id,
    inputMessages: snapshotMessages as unknown as object,
    output:
      lastAssistantMessageId === null
        ? null
        : ({
            messageId: lastAssistantMessageId,
            stopReason: lastStopReason,
          } as object),
    toolCallsCount: totalToolCalls,
    tokensInput: lastUsage?.inputTokens ?? null,
    tokensOutput: lastUsage?.outputTokens ?? null,
    durationMs: Date.now() - startedAt,
    status: runStatus,
    error: errorMessage,
  })

  logger.info(
    {
      agent: agent.slug,
      userId,
      conversationId,
      iterations: iteration,
      durationMs: Date.now() - startedAt,
      toolCalls: totalToolCalls,
      status: runStatus,
    },
    'agent run finished',
  )

  if (runStatus === 'success' && lastAssistantMessageId !== null) {
    yield {
      type: 'done',
      conversationId,
      messageId: lastAssistantMessageId,
    }
  }
}

import { createParser, type EventSourceMessage } from 'eventsource-parser'

import type { LLMStreamChunk } from '@/lib/llm/types'

export type ChatStreamEvent =
  | { kind: 'chunk'; chunk: LLMStreamChunk }
  | { kind: 'conversation_created'; conversationId: number; title: string }
  | { kind: 'done'; conversationId: number; messageId: number }

export interface ChatStreamOptions {
  agentSlug: string
  conversationId: number | null
  message: string
  signal?: AbortSignal
}

/**
 * Streams a chat turn from `POST /api/chat/[agentSlug]` and yields parsed
 * events. Uses fetch + ReadableStream because the EventSource API is GET-only.
 */
export async function* streamChat(options: ChatStreamOptions): AsyncGenerator<ChatStreamEvent> {
  const response = await fetch(`/api/chat/${options.agentSlug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      conversationId: options.conversationId,
      message: options.message,
    }),
    signal: options.signal,
  })

  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = body?.error ?? JSON.stringify(body)
    } catch {
      detail = await response.text().catch(() => '')
    }
    throw new Error(`Chat request failed (${response.status}): ${detail}`)
  }
  if (!response.body) throw new Error('Response has no body')

  const queue: ChatStreamEvent[] = []
  let signal!: () => void
  let waiter = new Promise<void>((resolve) => {
    signal = resolve
  })
  function notify() {
    signal()
    waiter = new Promise<void>((resolve) => {
      signal = resolve
    })
  }

  const parser = createParser({
    onEvent(event: EventSourceMessage) {
      const parsed = parseEvent(event)
      if (parsed) {
        queue.push(parsed)
        notify()
      }
    },
  })

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let done = false

  ;(async () => {
    try {
      while (true) {
        const { value, done: streamDone } = await reader.read()
        if (streamDone) break
        if (value) parser.feed(decoder.decode(value, { stream: true }))
      }
    } finally {
      done = true
      notify()
    }
  })()

  while (true) {
    while (queue.length > 0) {
      yield queue.shift()!
    }
    if (done) return
    await waiter
  }
}

function parseEvent(event: EventSourceMessage): ChatStreamEvent | null {
  if (!event.data) return null
  let payload: unknown
  try {
    payload = JSON.parse(event.data)
  } catch {
    return null
  }

  if (event.event === 'conversation_created') {
    const data = payload as { conversationId?: unknown; title?: unknown }
    if (typeof data.conversationId === 'number' && typeof data.title === 'string') {
      return {
        kind: 'conversation_created',
        conversationId: data.conversationId,
        title: data.title,
      }
    }
    return null
  }
  if (event.event === 'done') {
    const data = payload as { conversationId?: unknown; messageId?: unknown }
    if (typeof data.conversationId === 'number' && typeof data.messageId === 'number') {
      return { kind: 'done', conversationId: data.conversationId, messageId: data.messageId }
    }
    return null
  }
  if (event.event === 'chunk' || !event.event) {
    return { kind: 'chunk', chunk: payload as LLMStreamChunk }
  }
  return null
}

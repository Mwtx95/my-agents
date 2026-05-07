import { describe, expect, it } from 'vitest'

import { MockLLMProvider } from '@/lib/llm/providers/mock'
import type { LLMStreamChunk } from '@/lib/llm/types'

async function collect(stream: AsyncIterable<LLMStreamChunk>): Promise<LLMStreamChunk[]> {
  const out: LLMStreamChunk[] = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

describe('MockLLMProvider', () => {
  it('exposes its name', () => {
    const provider = new MockLLMProvider({ charDelayMs: 0 })
    expect(provider.name).toBe('mock')
  })

  it('streams thinking_delta chunks before text_delta chunks for a normal message', async () => {
    const provider = new MockLLMProvider({
      charDelayMs: 0,
      thinking: 'thinking',
      reply: 'reply',
    })
    const chunks = await collect(
      provider.chat({
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    )

    const types = chunks.map((c) => c.type)
    const firstText = types.indexOf('text_delta')
    const lastThinking = types.lastIndexOf('thinking_delta')
    expect(lastThinking).toBeGreaterThanOrEqual(0)
    expect(firstText).toBeGreaterThan(lastThinking)

    const thinkingText = chunks
      .filter(
        (c): c is Extract<LLMStreamChunk, { type: 'thinking_delta' }> =>
          c.type === 'thinking_delta',
      )
      .map((c) => c.delta)
      .join('')
    expect(thinkingText).toBe('thinking')

    const text = chunks
      .filter((c): c is Extract<LLMStreamChunk, { type: 'text_delta' }> => c.type === 'text_delta')
      .map((c) => c.delta)
      .join('')
    expect(text).toBe('reply')
  })

  it('emits a final message_done chunk with usage', async () => {
    const provider = new MockLLMProvider({ charDelayMs: 0, thinking: 't', reply: 'r' })
    const chunks = await collect(
      provider.chat({
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    )
    const last = chunks.at(-1)
    expect(last?.type).toBe('message_done')
    if (last?.type === 'message_done') {
      expect(last.usage.inputTokens).toBeGreaterThan(0)
      expect(last.usage.outputTokens).toBeGreaterThan(0)
      expect(last.stopReason).toBe('end_turn')
    }
  })

  it('emits an error chunk when the user message contains "error"', async () => {
    const provider = new MockLLMProvider({ charDelayMs: 0 })
    const chunks = await collect(
      provider.chat({
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'please trigger an error' }],
      }),
    )
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.type).toBe('error')
  })

  it('emits a tool_call chunk when the user message contains "tool"', async () => {
    const provider = new MockLLMProvider({ charDelayMs: 0 })
    const chunks = await collect(
      provider.chat({
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'use a tool please' }],
      }),
    )
    const toolCall = chunks.find((c) => c.type === 'tool_call')
    expect(toolCall).toBeDefined()
    if (toolCall?.type === 'tool_call') {
      expect(toolCall.toolCall.name).toBe('echo')
      expect(toolCall.toolCall.id).toMatch(/^mock_tool_/)
    }
    expect(chunks.at(-1)?.type).toBe('message_done')
  })

  it('respects an aborted signal mid-stream', async () => {
    const provider = new MockLLMProvider({ charDelayMs: 1, thinking: 'aaaa', reply: 'bbbb' })
    const controller = new AbortController()
    const chunks: LLMStreamChunk[] = []
    for await (const chunk of provider.chat({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'go' }],
      signal: controller.signal,
    })) {
      chunks.push(chunk)
      if (chunks.length === 2) controller.abort()
    }
    // Stream should have terminated early; far short of the full thinking + reply.
    expect(chunks.length).toBeLessThan(8)
  })
})

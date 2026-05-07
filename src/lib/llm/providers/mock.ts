import type { LLMChatOptions, LLMProvider, LLMStreamChunk } from '../types'

export interface MockProviderOptions {
  /** Delay between streamed characters, in ms. Set to 0 in tests. */
  charDelayMs?: number
  /** Override the deterministic outputs for advanced testing scenarios. */
  thinking?: string
  reply?: string
}

const DEFAULT_THINKING =
  'The user sent a message. I will produce a short, friendly reply that demonstrates streaming.'

const DEFAULT_REPLY =
  'Hello from the mock LLM provider. Streaming works end-to-end. Replace LLM_PROVIDER=minimax to use the real model.'

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()

function pickDelay(min: number, max: number): number {
  if (max <= 0) return 0
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export class MockLLMProvider implements LLMProvider {
  readonly name = 'mock'
  private readonly charDelayMs: number
  private readonly thinking: string
  private readonly reply: string

  constructor(options: MockProviderOptions = {}) {
    this.charDelayMs = options.charDelayMs ?? 8
    this.thinking = options.thinking ?? DEFAULT_THINKING
    this.reply = options.reply ?? DEFAULT_REPLY
  }

  async *chat(options: LLMChatOptions): AsyncIterable<LLMStreamChunk> {
    const lastUser = [...options.messages].reverse().find((m) => m.role === 'user')
    const lastUserContent = lastUser?.content ?? ''

    if (/\berror\b/i.test(lastUserContent)) {
      yield { type: 'error', error: 'Mock provider: user requested an error.' }
      return
    }

    if (/\btool\b/i.test(lastUserContent)) {
      yield {
        type: 'tool_call',
        toolCall: {
          id: `mock_tool_${Date.now()}`,
          name: 'echo',
          input: { text: lastUserContent },
        },
      }
      yield {
        type: 'message_done',
        usage: { inputTokens: estimateTokens(options), outputTokens: 8 },
        stopReason: 'tool_use',
      }
      return
    }

    for (const ch of this.thinking) {
      yield { type: 'thinking_delta', delta: ch }
      await sleep(this.charDelayMs > 0 ? pickDelay(5, 15) : 0)
      if (options.signal?.aborted) return
    }

    for (const ch of this.reply) {
      yield { type: 'text_delta', delta: ch }
      await sleep(this.charDelayMs > 0 ? pickDelay(5, 15) : 0)
      if (options.signal?.aborted) return
    }

    yield {
      type: 'message_done',
      usage: {
        inputTokens: estimateTokens(options),
        outputTokens: this.thinking.length + this.reply.length,
      },
      stopReason: 'end_turn',
    }
  }
}

function estimateTokens(options: LLMChatOptions): number {
  const all = [options.systemPrompt, ...options.messages.map((m) => m.content)].join(' ')
  return Math.ceil(all.length / 4)
}

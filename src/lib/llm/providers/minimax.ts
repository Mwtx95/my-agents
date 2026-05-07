import Anthropic from '@anthropic-ai/sdk'
import type {
  MessageParam,
  TextBlockParam,
  ToolResultBlockParam,
  ToolUseBlockParam,
  Tool as AnthropicTool,
} from '@anthropic-ai/sdk/resources/messages.mjs'

import type {
  LLMChatOptions,
  LLMMessage,
  LLMProvider,
  LLMStopReason,
  LLMStreamChunk,
  LLMToolCall,
} from '../types'

export interface MiniMaxProviderOptions {
  apiKey: string
  baseURL: string
  defaultModel: string
}

/**
 * MiniMax M2.7 provider via the Anthropic-compatible API.
 *
 * NOTE: M2.7 is an interleaved-thinking model. Assistant messages produce
 * `<think>...</think>` blocks before their final answer. We:
 *   1. Reconstruct those blocks when sending history back, by prepending the
 *      stored `thinking` content as `<think>...</think>` to the assistant's
 *      `content` for that turn.
 *   2. Parse the streaming response text and split it into `thinking_delta`
 *      and `text_delta` chunks based on the `<think>` tag state.
 *
 * This provider is not exercised by tests in PR 1 (no real key in CI).
 */
export class MiniMaxProvider implements LLMProvider {
  readonly name = 'minimax'
  private readonly client: Anthropic
  private readonly defaultModel: string

  constructor(options: MiniMaxProviderOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    })
    this.defaultModel = options.defaultModel
  }

  async *chat(options: LLMChatOptions): AsyncIterable<LLMStreamChunk> {
    const messages = toAnthropicMessages(options.messages)
    const tools = options.tools?.map(toAnthropicTool)

    let stream
    try {
      stream = this.client.messages.stream(
        {
          model: options.model ?? this.defaultModel,
          system: options.systemPrompt,
          messages,
          max_tokens: options.maxTokens ?? 4096,
          temperature: options.temperature ?? 1.0,
          ...(tools && tools.length > 0 ? { tools } : {}),
        },
        { signal: options.signal },
      )
    } catch (err) {
      yield { type: 'error', error: errorMessage(err) }
      return
    }

    const thinkParser = new ThinkTagParser()
    const pendingToolCalls = new Map<number, ToolUseAccumulator>()

    try {
      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            pendingToolCalls.set(event.index, {
              id: event.content_block.id,
              name: event.content_block.name,
              jsonBuffer: '',
            })
          }
          continue
        }

        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            for (const out of thinkParser.push(event.delta.text)) {
              yield out
            }
          } else if (event.delta.type === 'input_json_delta') {
            const acc = pendingToolCalls.get(event.index)
            if (acc) acc.jsonBuffer += event.delta.partial_json
          }
          continue
        }

        if (event.type === 'content_block_stop') {
          const acc = pendingToolCalls.get(event.index)
          if (acc) {
            const toolCall = finalizeToolUse(acc)
            yield { type: 'tool_call', toolCall }
            pendingToolCalls.delete(event.index)
          }
          continue
        }
      }

      for (const out of thinkParser.flush()) yield out

      const final = await stream.finalMessage()
      yield {
        type: 'message_done',
        usage: {
          inputTokens: final.usage?.input_tokens ?? 0,
          outputTokens: final.usage?.output_tokens ?? 0,
        },
        stopReason: mapStopReason(final.stop_reason),
      }
    } catch (err) {
      yield { type: 'error', error: errorMessage(err) }
    }
  }
}

// -----------------------------------------------------------------------------
// Message translation
// -----------------------------------------------------------------------------

function toAnthropicMessages(messages: LLMMessage[]): MessageParam[] {
  const result: MessageParam[] = []
  for (const m of messages) {
    if (m.role === 'system') {
      // System prompt goes in its own field, not in the message array.
      continue
    }
    if (m.role === 'user') {
      result.push({ role: 'user', content: m.content })
      continue
    }
    if (m.role === 'assistant') {
      const blocks: Array<TextBlockParam | ToolUseBlockParam> = []
      const text = m.thinking ? `<think>${m.thinking}</think>${m.content}` : m.content
      if (text.length > 0) blocks.push({ type: 'text', text })
      for (const call of m.toolCalls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.input,
        })
      }
      result.push({ role: 'assistant', content: blocks })
      continue
    }
    if (m.role === 'tool') {
      if (!m.toolCallId) {
        throw new Error('Tool messages must include a toolCallId')
      }
      const block: ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content,
      }
      result.push({ role: 'user', content: [block] })
      continue
    }
  }
  return result
}

function toAnthropicTool(tool: {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}): AnthropicTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as AnthropicTool['input_schema'],
  }
}

// -----------------------------------------------------------------------------
// Streaming text -> thinking/text split
// -----------------------------------------------------------------------------

/**
 * Splits an incoming text stream into thinking_delta and text_delta chunks
 * based on `<think>...</think>` tag state. Buffers partial tag tokens so a
 * `<` arriving in one delta doesn't get misclassified.
 */
class ThinkTagParser {
  private inThink = false
  private buffer = '';

  *push(input: string): Iterable<LLMStreamChunk> {
    this.buffer += input
    while (this.buffer.length > 0) {
      if (this.inThink) {
        const closeIdx = this.buffer.indexOf('</think>')
        if (closeIdx === -1) {
          // Hold back enough tail to recognize a partial closing tag.
          const safe = this.buffer.length - '</think>'.length + 1
          if (safe > 0) {
            yield { type: 'thinking_delta', delta: this.buffer.slice(0, safe) }
            this.buffer = this.buffer.slice(safe)
          }
          return
        }
        if (closeIdx > 0) {
          yield { type: 'thinking_delta', delta: this.buffer.slice(0, closeIdx) }
        }
        this.buffer = this.buffer.slice(closeIdx + '</think>'.length)
        this.inThink = false
      } else {
        const openIdx = this.buffer.indexOf('<think>')
        if (openIdx === -1) {
          // Hold back enough tail to recognize a partial opening tag.
          const safe = this.buffer.length - '<think>'.length + 1
          if (safe > 0) {
            yield { type: 'text_delta', delta: this.buffer.slice(0, safe) }
            this.buffer = this.buffer.slice(safe)
          }
          return
        }
        if (openIdx > 0) {
          yield { type: 'text_delta', delta: this.buffer.slice(0, openIdx) }
        }
        this.buffer = this.buffer.slice(openIdx + '<think>'.length)
        this.inThink = true
      }
    }
  }

  *flush(): Iterable<LLMStreamChunk> {
    if (this.buffer.length === 0) return
    if (this.inThink) {
      yield { type: 'thinking_delta', delta: this.buffer }
    } else {
      yield { type: 'text_delta', delta: this.buffer }
    }
    this.buffer = ''
  }
}

interface ToolUseAccumulator {
  id: string
  name: string
  jsonBuffer: string
}

function finalizeToolUse(acc: ToolUseAccumulator): LLMToolCall {
  let input: Record<string, unknown> = {}
  if (acc.jsonBuffer.length > 0) {
    try {
      input = JSON.parse(acc.jsonBuffer)
    } catch {
      input = { _raw: acc.jsonBuffer }
    }
  }
  return { id: acc.id, name: acc.name, input }
}

function mapStopReason(reason: string | null | undefined): LLMStopReason {
  switch (reason) {
    case 'end_turn':
    case 'tool_use':
    case 'max_tokens':
    case 'stop_sequence':
      return reason
    default:
      return 'end_turn'
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

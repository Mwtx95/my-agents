export type LLMRole = 'system' | 'user' | 'assistant' | 'tool'

export interface LLMMessage {
  role: LLMRole
  content: string
  /** Assistant-only. MiniMax M2.7 thinking content; preserved across turns. */
  thinking?: string
  toolCalls?: LLMToolCall[]
  /** Tool messages only — references the assistant tool_call this is a result for. */
  toolCallId?: string
}

export interface LLMToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface LLMTool {
  name: string
  description: string
  /** JSON Schema describing the tool's input. */
  inputSchema: Record<string, unknown>
}

export interface LLMUsage {
  inputTokens: number
  outputTokens: number
}

export type LLMStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error'

export type LLMStreamChunk =
  | { type: 'thinking_delta'; delta: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; toolCall: LLMToolCall }
  | { type: 'message_done'; usage: LLMUsage; stopReason: LLMStopReason }
  | { type: 'error'; error: string }

export interface LLMChatOptions {
  systemPrompt: string
  messages: LLMMessage[]
  tools?: LLMTool[]
  temperature?: number
  maxTokens?: number
  /** Optional model override; provider falls back to its default. */
  model?: string
  /** Caller-provided abort signal. Providers should honor this. */
  signal?: AbortSignal
}

export interface LLMProvider {
  readonly name: string
  chat(options: LLMChatOptions): AsyncIterable<LLMStreamChunk>
}

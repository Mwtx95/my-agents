'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { streamChat } from './sse-client'

export interface InitialMessage {
  id: number
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  thinking: string | null
}

interface ChatPanelProps {
  agentSlug: string
  agentName: string
  agentDescription: string | null
  conversationId: number | null
  conversationTitle?: string | null
  initialMessages: InitialMessage[]
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  thinking: string
  /** Visible during streaming; switches to false when persisted. */
  streaming?: boolean
  errored?: boolean
}

function fromInitial(msg: InitialMessage): ChatMessage {
  return {
    id: `db-${msg.id}`,
    role: msg.role,
    content: msg.content,
    thinking: msg.thinking ?? '',
  }
}

let tempIdCounter = 0
const tempId = (prefix: string) => `${prefix}-${Date.now()}-${++tempIdCounter}`

export function ChatPanel(props: ChatPanelProps) {
  const router = useRouter()
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    props.initialMessages.map(fromInitial),
  )
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [, startTransition] = useTransition()
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Reset state when navigating between conversations.
  useEffect(() => {
    setMessages(props.initialMessages.map(fromInitial))
  }, [props.conversationId, props.initialMessages])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')
    setIsStreaming(true)

    const userMsg: ChatMessage = {
      id: tempId('user'),
      role: 'user',
      content: text,
      thinking: '',
    }
    const assistantMsg: ChatMessage = {
      id: tempId('assistant'),
      role: 'assistant',
      content: '',
      thinking: '',
      streaming: true,
    }

    setMessages((prev) => [...prev, userMsg, assistantMsg])

    const controller = new AbortController()
    abortRef.current = controller

    let nextConversationId = props.conversationId

    try {
      for await (const event of streamChat({
        agentSlug: props.agentSlug,
        conversationId: props.conversationId,
        message: text,
        signal: controller.signal,
      })) {
        if (event.kind === 'conversation_created') {
          nextConversationId = event.conversationId
        } else if (event.kind === 'chunk') {
          const chunk = event.chunk
          if (chunk.type === 'text_delta') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id ? { ...m, content: m.content + chunk.delta } : m,
              ),
            )
          } else if (chunk.type === 'thinking_delta') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id ? { ...m, thinking: m.thinking + chunk.delta } : m,
              ),
            )
          } else if (chunk.type === 'error') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, content: chunk.error, errored: true, streaming: false }
                  : m,
              ),
            )
          }
        } else if (event.kind === 'done') {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, streaming: false } : m)),
          )
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed'
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: message, errored: true, streaming: false }
            : m,
        ),
      )
    } finally {
      setIsStreaming(false)
      abortRef.current = null
      // After the first message in a brand-new conversation, swap the URL so
      // refresh + sidebar links work.
      if (props.conversationId === null && nextConversationId !== null) {
        startTransition(() => {
          router.replace(`/${props.agentSlug}/${nextConversationId}`)
          router.refresh()
        })
      } else {
        startTransition(() => router.refresh())
      }
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-neutral-200 bg-white px-6 py-3">
        <h1 className="text-sm font-semibold text-neutral-900">
          {props.conversationTitle ?? props.agentName}
        </h1>
        {props.agentDescription ? (
          <p className="mt-0.5 text-xs text-neutral-500">{props.agentDescription}</p>
        ) : null}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 ? (
          <p className="mx-auto max-w-prose pt-12 text-center text-sm text-neutral-500">
            Send a message to start.
          </p>
        ) : (
          <ul className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.map((m) => (
              <li key={m.id}>
                <MessageBubble message={m} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={send} className="border-t border-neutral-200 bg-white px-6 py-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Message ${props.agentName}…`}
            rows={2}
            className="flex-1 resize-none rounded-md border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
            disabled={isStreaming}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(e as unknown as React.FormEvent)
              }
            }}
          />
          <button
            type="submit"
            disabled={isStreaming || input.trim().length === 0}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isStreaming ? 'Streaming…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-neutral-900 px-4 py-2 text-sm text-white">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {message.thinking ? (
        <ThoughtsPane content={message.thinking} streaming={message.streaming} />
      ) : null}
      <div
        className={
          'whitespace-pre-wrap rounded-2xl border px-4 py-2 text-sm ' +
          (message.errored
            ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-neutral-200 bg-white text-neutral-900')
        }
      >
        {message.content ||
          (message.streaming ? <span className="text-neutral-400">…</span> : null)}
      </div>
    </div>
  )
}

function ThoughtsPane({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <details className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
      <summary className="cursor-pointer select-none text-neutral-500">
        {streaming ? 'Thinking…' : 'Thoughts'}
      </summary>
      <div className="mt-2 whitespace-pre-wrap">{content}</div>
    </details>
  )
}

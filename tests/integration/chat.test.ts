import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

import { integrationEnabled } from './setup'

const describeIntegration = integrationEnabled ? describe : describe.skip

describeIntegration('POST /api/chat/[agentSlug]', () => {
  let userId: string

  beforeEach(async () => {
    vi.resetModules()
    const { db } = await import('@/db')
    const { agents, conversations, messages, agentRuns, users } = await import('@/db/schema')

    // Wipe app data between tests (preserve schema; users get cleared too so
    // we get a fresh row each test).
    await db.delete(agentRuns)
    await db.delete(messages)
    await db.delete(conversations)
    await db.delete(agents)
    await db.delete(users)

    await db.insert(agents).values({
      slug: 'pm',
      name: 'Project Manager',
      description: 'Test agent',
      systemPrompt: 'You are a test agent.',
    })

    const [user] = await db
      .insert(users)
      .values({ email: `test-${Date.now()}-${Math.random()}@example.com` })
      .returning({ id: users.id })
    if (!user) throw new Error('failed to insert user')
    userId = user.id

    vi.doMock('@/lib/auth', () => ({
      auth: async () => ({
        user: { id: userId, email: 'test@example.com' },
        expires: new Date(Date.now() + 86400_000).toISOString(),
      }),
    }))

    vi.doMock('@/lib/llm', async () => {
      const actual = await vi.importActual<typeof import('@/lib/llm')>('@/lib/llm')
      const { MockLLMProvider } = await import('@/lib/llm/providers/mock')
      const provider = new MockLLMProvider({
        charDelayMs: 0,
        thinking: 'reasoning',
        reply: 'hello world',
      })
      return { ...actual, getLLMProvider: () => provider }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('@/lib/auth')
    vi.doUnmock('@/lib/llm')
  })

  it('streams SSE chunks and persists user + assistant messages', async () => {
    const { POST } = await import('@/app/api/chat/[agentSlug]/route')

    const req = new Request('http://localhost/api/chat/pm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: null, message: 'hi there' }),
    })

    const res = await POST(req, { params: { agentSlug: 'pm' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')

    const text = await res.text()
    const events = parseSSE(text)

    const eventNames = events.map((e) => e.event)
    expect(eventNames).toContain('conversation_created')
    expect(eventNames).toContain('chunk')
    expect(eventNames).toContain('done')

    const chunks = events.filter((e) => e.event === 'chunk').map((e) => JSON.parse(e.data))
    expect(chunks.some((c) => c.type === 'thinking_delta')).toBe(true)
    expect(chunks.some((c) => c.type === 'text_delta')).toBe(true)

    const doneEvent = events.find((e) => e.event === 'done')
    expect(doneEvent).toBeDefined()
    const done = JSON.parse(doneEvent!.data) as { conversationId: number; messageId: number }
    expect(done.conversationId).toBeGreaterThan(0)
    expect(done.messageId).toBeGreaterThan(0)

    // DB assertions.
    const { db } = await import('@/db')
    const { messages, agentRuns } = await import('@/db/schema')

    const persistedMessages = await db.query.messages.findMany({
      where: eq(messages.conversationId, done.conversationId),
    })
    expect(persistedMessages).toHaveLength(2)
    const userMsg = persistedMessages.find((m) => m.role === 'user')
    const assistantMsg = persistedMessages.find((m) => m.role === 'assistant')
    expect(userMsg?.content).toBe('hi there')
    expect(assistantMsg?.content).toBe('hello world')
    expect(assistantMsg?.thinking).toBe('reasoning')

    const runs = await db.query.agentRuns.findMany({
      where: eq(agentRuns.conversationId, done.conversationId),
    })
    expect(runs).toHaveLength(1)
    expect(runs[0]?.status).toBe('success')
  })

  it('returns 401 when no session is present', async () => {
    vi.doMock('@/lib/auth', () => ({
      auth: async () => null,
    }))

    const { POST } = await import('@/app/api/chat/[agentSlug]/route')
    const req = new Request('http://localhost/api/chat/pm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: null, message: 'hi' }),
    })
    const res = await POST(req, { params: { agentSlug: 'pm' } })
    expect(res.status).toBe(401)
  })

  it('returns 404 for an unknown agent slug', async () => {
    const { POST } = await import('@/app/api/chat/[agentSlug]/route')
    const req = new Request('http://localhost/api/chat/nope', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: null, message: 'hi' }),
    })
    const res = await POST(req, { params: { agentSlug: 'nope' } })
    expect(res.status).toBe(404)
  })

  it('returns 400 for an empty message', async () => {
    const { POST } = await import('@/app/api/chat/[agentSlug]/route')
    const req = new Request('http://localhost/api/chat/pm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: null, message: '' }),
    })
    const res = await POST(req, { params: { agentSlug: 'pm' } })
    expect(res.status).toBe(400)
  })
})

interface ParsedEvent {
  event: string
  data: string
}

function parseSSE(text: string): ParsedEvent[] {
  const events: ParsedEvent[] = []
  for (const block of text.split('\n\n')) {
    if (!block.trim()) continue
    let event = 'message'
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice('event: '.length)
      else if (line.startsWith('data: ')) dataLines.push(line.slice('data: '.length))
    }
    if (dataLines.length > 0) events.push({ event, data: dataLines.join('\n') })
  }
  return events
}

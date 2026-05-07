import { and, asc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { db } from '@/db'
import { agents, conversations, messages } from '@/db/schema'
import { auth } from '@/lib/auth'
import { badRequest, forbidden, notFound, unauthorized, withErrorHandler } from '@/lib/api/errors'

export const dynamic = 'force-dynamic'

function parseId(raw: string): number {
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) {
    throw badRequest('Invalid conversation id')
  }
  return id
}

export const GET = withErrorHandler(
  async (_req: Request, { params }: { params: { id: string } }) => {
    const session = await auth()
    if (!session?.user?.id) throw unauthorized()
    const id = parseId(params.id)

    const convo = await db
      .select({
        id: conversations.id,
        userId: conversations.userId,
        agentId: conversations.agentId,
        agentSlug: agents.slug,
        agentName: agents.name,
        title: conversations.title,
        archived: conversations.archived,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .innerJoin(agents, eq(conversations.agentId, agents.id))
      .where(eq(conversations.id, id))
      .limit(1)
      .then((rows) => rows[0])

    if (!convo) throw notFound('Conversation not found')
    if (convo.userId !== session.user.id) throw forbidden()

    const msgs = await db.query.messages.findMany({
      where: eq(messages.conversationId, id),
      orderBy: [asc(messages.createdAt), asc(messages.id)],
    })

    return NextResponse.json({
      conversation: {
        id: convo.id,
        agentId: convo.agentId,
        agentSlug: convo.agentSlug,
        agentName: convo.agentName,
        title: convo.title,
        archived: convo.archived,
        createdAt: convo.createdAt,
        updatedAt: convo.updatedAt,
      },
      messages: msgs.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        thinking: m.thinking,
        toolCalls: m.toolCalls,
        toolCallId: m.toolCallId,
        model: m.model,
        createdAt: m.createdAt,
      })),
    })
  },
)

export const DELETE = withErrorHandler(
  async (_req: Request, { params }: { params: { id: string } }) => {
    const session = await auth()
    if (!session?.user?.id) throw unauthorized()
    const id = parseId(params.id)

    const result = await db
      .update(conversations)
      .set({ archived: true, updatedAt: new Date() })
      .where(and(eq(conversations.id, id), eq(conversations.userId, session.user.id)))
      .returning({ id: conversations.id })

    if (result.length === 0) throw notFound('Conversation not found')
    return NextResponse.json({ ok: true })
  },
)

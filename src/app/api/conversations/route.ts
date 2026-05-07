import { and, desc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { db } from '@/db'
import { agents, conversations } from '@/db/schema'
import { auth } from '@/lib/auth'
import { unauthorized, withErrorHandler } from '@/lib/api/errors'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(async (req: Request) => {
  const session = await auth()
  if (!session?.user?.id) throw unauthorized()

  const url = new URL(req.url)
  const agentSlug = url.searchParams.get('agentSlug')

  const where = agentSlug
    ? and(
        eq(conversations.userId, session.user.id),
        eq(conversations.archived, false),
        eq(agents.slug, agentSlug),
      )
    : and(eq(conversations.userId, session.user.id), eq(conversations.archived, false))

  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      agentId: conversations.agentId,
      agentSlug: agents.slug,
      agentName: agents.name,
      updatedAt: conversations.updatedAt,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .innerJoin(agents, eq(conversations.agentId, agents.id))
    .where(where)
    .orderBy(desc(conversations.updatedAt))

  return NextResponse.json({ conversations: rows })
})

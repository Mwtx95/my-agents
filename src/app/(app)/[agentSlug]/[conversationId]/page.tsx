import { notFound, redirect } from 'next/navigation'
import { and, asc, eq } from 'drizzle-orm'

import { db } from '@/db'
import { agents, conversations, messages } from '@/db/schema'
import { auth } from '@/lib/auth'
import { ChatPanel, type InitialMessage } from '@/components/chat/chat-panel'

interface PageProps {
  params: { agentSlug: string; conversationId: string }
}

export default async function ConversationPage({ params }: PageProps) {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')

  const conversationId = Number(params.conversationId)
  if (!Number.isInteger(conversationId) || conversationId <= 0) notFound()

  const convo = await db
    .select({
      id: conversations.id,
      userId: conversations.userId,
      title: conversations.title,
      agentSlug: agents.slug,
      agentName: agents.name,
      agentDescription: agents.description,
    })
    .from(conversations)
    .innerJoin(agents, eq(conversations.agentId, agents.id))
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, session.user.id)))
    .limit(1)
    .then((rows) => rows[0])

  if (!convo) notFound()
  if (convo.agentSlug !== params.agentSlug) {
    redirect(`/${convo.agentSlug}/${convo.id}`)
  }

  const rows = await db.query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
    orderBy: [asc(messages.createdAt), asc(messages.id)],
  })

  const initialMessages: InitialMessage[] = rows.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    thinking: m.thinking,
  }))

  return (
    <ChatPanel
      agentSlug={convo.agentSlug}
      agentName={convo.agentName}
      agentDescription={convo.agentDescription}
      conversationId={convo.id}
      conversationTitle={convo.title}
      initialMessages={initialMessages}
    />
  )
}

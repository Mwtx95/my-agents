import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { agents } from '@/db/schema'
import { ChatPanel } from '@/components/chat/chat-panel'

interface PageProps {
  params: { agentSlug: string }
}

export default async function NewConversationPage({ params }: PageProps) {
  const agent = await db.query.agents.findFirst({
    where: eq(agents.slug, params.agentSlug),
  })
  if (!agent || !agent.enabled) notFound()

  return (
    <ChatPanel
      agentSlug={agent.slug}
      agentName={agent.name}
      agentDescription={agent.description}
      conversationId={null}
      initialMessages={[]}
    />
  )
}

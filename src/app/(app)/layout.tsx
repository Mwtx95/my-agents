import { redirect } from 'next/navigation'
import { and, desc, eq } from 'drizzle-orm'

import { db } from '@/db'
import { agents, conversations } from '@/db/schema'
import { auth, signOut } from '@/lib/auth'
import { Sidebar } from '@/components/sidebar/sidebar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')
  const userId = session.user.id

  // PR 2 only exposes the PM agent in the sidebar; PR 3 adds the agent
  // switcher and surfaces Marketing.
  const visibleAgents = await db
    .select({
      id: agents.id,
      slug: agents.slug,
      name: agents.name,
      description: agents.description,
    })
    .from(agents)
    .where(and(eq(agents.enabled, true), eq(agents.slug, 'pm')))

  const userConversations = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      agentSlug: agents.slug,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .innerJoin(agents, eq(conversations.agentId, agents.id))
    .where(
      and(
        eq(conversations.userId, userId),
        eq(conversations.archived, false),
        eq(agents.slug, 'pm'),
      ),
    )
    .orderBy(desc(conversations.updatedAt))

  async function handleSignOut() {
    'use server'
    await signOut({ redirectTo: '/sign-in' })
  }

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-50">
      <Sidebar
        userEmail={session.user.email ?? null}
        agents={visibleAgents}
        conversations={userConversations}
        signOutAction={handleSignOut}
      />
      <main className="flex h-full flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  )
}

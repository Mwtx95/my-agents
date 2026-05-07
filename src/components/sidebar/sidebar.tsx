import Link from 'next/link'

interface AgentRow {
  id: number
  slug: string
  name: string
  description: string | null
}

interface ConversationRow {
  id: number
  title: string | null
  agentSlug: string
  updatedAt: Date
}

interface SidebarProps {
  userEmail: string | null
  agents: AgentRow[]
  conversations: ConversationRow[]
  signOutAction: () => Promise<void>
}

export function Sidebar({ userEmail, agents, conversations, signOutAction }: SidebarProps) {
  // PR 2 only renders the PM agent. PR 3 will swap this for an agent picker.
  const activeAgent = agents[0]

  return (
    <aside className="flex h-full w-72 flex-col border-r border-neutral-200 bg-white">
      <div className="px-4 py-3">
        <Link href="/" className="block text-sm font-semibold tracking-tight text-neutral-900">
          Multi-Agent Platform
        </Link>
        {activeAgent ? <p className="mt-1 text-xs text-neutral-500">{activeAgent.name}</p> : null}
      </div>

      <div className="border-t border-neutral-200 px-2 py-2">
        <Link
          href={activeAgent ? `/${activeAgent.slug}` : '/'}
          className="block rounded-md px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-100"
        >
          + New conversation
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label="Conversations">
        {conversations.length === 0 ? (
          <p className="px-3 py-2 text-xs text-neutral-500">No conversations yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/${c.agentSlug}/${c.id}`}
                  className="block truncate rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
                  title={c.title ?? `Conversation ${c.id}`}
                >
                  {c.title ?? `Conversation ${c.id}`}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <form action={signOutAction} className="border-t border-neutral-200 px-2 py-2">
        <div className="px-3 pb-2 text-xs text-neutral-500">{userEmail ?? 'Signed in'}</div>
        <button
          type="submit"
          className="w-full rounded-md px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
        >
          Sign out
        </button>
      </form>
    </aside>
  )
}

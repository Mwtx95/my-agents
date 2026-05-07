import { asc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { db } from '@/db'
import { agents } from '@/db/schema'
import { auth } from '@/lib/auth'
import { unauthorized, withErrorHandler } from '@/lib/api/errors'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(async () => {
  const session = await auth()
  if (!session?.user?.id) throw unauthorized()

  const rows = await db
    .select({
      id: agents.id,
      slug: agents.slug,
      name: agents.name,
      description: agents.description,
    })
    .from(agents)
    .where(eq(agents.enabled, true))
    .orderBy(asc(agents.id))

  return NextResponse.json({ agents: rows })
})

import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { env } from '@/lib/env'
import * as schema from './schema'

declare global {
  // eslint-disable-next-line no-var
  var __dbPool: Pool | undefined
}

const pool =
  global.__dbPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
  })

if (env.NODE_ENV !== 'production') {
  global.__dbPool = pool
}

export const db = drizzle(pool, { schema, casing: 'snake_case' })
export { schema }

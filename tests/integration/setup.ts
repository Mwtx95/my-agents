/**
 * Integration test bootstrap. Loaded via vitest's `setupFiles` for the
 * `integration` glob. Applies the Drizzle schema to the configured database
 * once per test process.
 *
 * Tests are gated behind `INTEGRATION_DATABASE_URL` — when unset, all
 * integration tests are skipped. CI sets it to a postgres service URL.
 */
import { execSync } from 'node:child_process'

import { afterAll, beforeAll } from 'vitest'

export const integrationDatabaseUrl = process.env.INTEGRATION_DATABASE_URL
export const integrationEnabled = Boolean(integrationDatabaseUrl)

if (integrationEnabled) {
  // Make the URL visible to drizzle-kit and the app's env validator.
  process.env.DATABASE_URL = integrationDatabaseUrl
  process.env.LLM_PROVIDER = 'mock'
  process.env.AUTH_SECRET ??= 'integration-test-secret'

  beforeAll(() => {
    execSync('pnpm drizzle-kit push --force', {
      stdio: 'inherit',
      env: process.env,
    })
  })

  afterAll(async () => {
    // Best-effort: close any pooled connections so vitest can exit cleanly.
    try {
      const { db } = await import('@/db')
      // drizzle's underlying pool exposes .end via the client we constructed.
      const pool = (db.$client as unknown as { end?: () => Promise<void> }).end
      if (pool) await pool.call(db.$client)
    } catch {
      /* ignore */
    }
  })
}

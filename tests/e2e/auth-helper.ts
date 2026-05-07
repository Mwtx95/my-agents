/**
 * Bypasses the magic-link round-trip in e2e tests by reading the
 * verification_tokens row that Auth.js writes when a user submits the sign-in
 * form, then constructing the callback URL the email link would have used.
 */
import { Pool } from 'pg'

export interface VerificationLookup {
  identifier: string
  token: string
}

export async function findVerificationToken(
  databaseUrl: string,
  email: string,
  attempts = 20,
  delayMs = 250,
): Promise<VerificationLookup> {
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    for (let i = 0; i < attempts; i++) {
      const { rows } = await pool.query<{ identifier: string; token: string }>(
        `select identifier, token from verification_tokens where identifier = $1 order by expires desc limit 1`,
        [email],
      )
      if (rows[0]) return rows[0]
      await new Promise((r) => setTimeout(r, delayMs))
    }
    throw new Error(`No verification token for ${email} after ${attempts} attempts`)
  } finally {
    await pool.end()
  }
}

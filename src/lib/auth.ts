import NextAuth, { type NextAuthConfig } from 'next-auth'
import Nodemailer from 'next-auth/providers/nodemailer'
import { DrizzleAdapter } from '@auth/drizzle-adapter'

import { db } from '@/db'
import { accounts, sessions, users, verificationTokens } from '@/db/schema'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'

/**
 * Email provider configuration.
 *
 * Auth.js v5's Nodemailer provider needs a `server` option, but for local dev
 * we want magic links to go to the console without requiring an SMTP server.
 * We do that by overriding `sendVerificationRequest` with a console logger.
 */
const emailProvider = Nodemailer({
  // Auth.js requires _something_ here even when we override sendVerificationRequest.
  server: env.AUTH_EMAIL_SERVER ?? 'smtp://localhost:1025',
  from: env.AUTH_EMAIL_FROM || 'no-reply@localhost',
  async sendVerificationRequest({ identifier, url }) {
    if (!env.AUTH_EMAIL_FROM && !env.AUTH_RESEND_API_KEY && !env.AUTH_EMAIL_SERVER) {
      // Dev mode: log to console.
      logger.info(
        { email: identifier, url },
        '\n==============================\nMagic link sign-in (dev mode)\nTo: %s\nLink: %s\n==============================\n',
        identifier,
        url,
      )
      return
    }
    // Production / configured dev — fall back to the default Nodemailer sender.
    // Importing inside the function avoids loading nodemailer when we don't need it.
    const { createTransport } = await import('nodemailer')
    const transport = createTransport(env.AUTH_EMAIL_SERVER ?? '')
    await transport.sendMail({
      to: identifier,
      from: env.AUTH_EMAIL_FROM || 'no-reply@localhost',
      subject: 'Sign in to Multi-Agent Platform',
      text: `Sign in: ${url}\n`,
      html: `<p>Sign in: <a href="${url}">${url}</a></p>`,
    })
  },
})

export const authConfig: NextAuthConfig = {
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: 'database' },
  secret: env.AUTH_SECRET,
  providers: [emailProvider],
  pages: {
    signIn: '/sign-in',
  },
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)

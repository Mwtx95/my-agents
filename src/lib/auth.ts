import NextAuth, { type NextAuthConfig } from 'next-auth'
import Nodemailer from 'next-auth/providers/nodemailer'
import { DrizzleAdapter } from '@auth/drizzle-adapter'

import { db } from '@/db'
import { accounts, sessions, users, verificationTokens } from '@/db/schema'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'

/**
 * Auth.js v5 setup. Sessions are JWT-backed so we don't need a session-table
 * lookup on every request. The Drizzle adapter still owns users / accounts /
 * verification_tokens for the email magic-link flow.
 */
const emailProvider = Nodemailer({
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
  session: { strategy: 'jwt' },
  secret: env.AUTH_SECRET,
  providers: [emailProvider],
  pages: {
    signIn: '/sign-in',
    verifyRequest: '/sign-in?verify=1',
    error: '/sign-in',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id
      return token
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub
      return session
    },
  },
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)

import { test, expect } from '@playwright/test'

import { findVerificationToken } from './auth-helper'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/agents'

test.describe('chat smoke', () => {
  test('sign in, send a message, see the streamed response', async ({ page, baseURL }) => {
    const email = `smoke-${Date.now()}@example.test`

    // 1. Submit the sign-in form. Auth.js writes a verification_tokens row,
    //    redirects to /sign-in?verify=1, and (in dev) logs the link to stdout.
    await page.goto('/sign-in')
    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { name: 'Send magic link' }).click()
    await expect(page).toHaveURL(/verify=1/)

    // 2. Read the magic-link token from Postgres and follow the equivalent
    //    callback URL that the emailed link would have used.
    const { token, identifier } = await findVerificationToken(DATABASE_URL, email)
    const callback = new URL('/api/auth/callback/nodemailer', baseURL)
    callback.searchParams.set('callbackUrl', '/')
    callback.searchParams.set('token', token)
    callback.searchParams.set('email', identifier)
    await page.goto(callback.toString())

    // 3. We should land on the PM agent's empty conversation page.
    await expect(page).toHaveURL(/\/pm$/)
    await expect(page.getByRole('heading', { name: 'Project Manager' })).toBeVisible()

    // 4. Send a message and watch the response stream in.
    await page.getByPlaceholder(/Message Project Manager/).fill('hello there')
    await page.getByRole('button', { name: 'Send' }).click()

    // 5. The user message should be visible immediately.
    await expect(page.getByText('hello there')).toBeVisible()

    // 6. The mock provider streams thinking + text. Wait for the assistant
    //    bubble to populate with non-empty text.
    const thoughts = page.getByText('Thoughts').or(page.getByText('Thinking'))
    await expect(thoughts).toBeVisible({ timeout: 15_000 })

    await expect(page.getByText(/mock LLM provider/i)).toBeVisible({ timeout: 15_000 })

    // 7. The URL should now include the conversation id.
    await expect(page).toHaveURL(/\/pm\/\d+/)
  })
})

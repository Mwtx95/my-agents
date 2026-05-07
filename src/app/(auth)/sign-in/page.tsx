import { redirect } from 'next/navigation'

import { auth, signIn } from '@/lib/auth'
import { SignInForm } from './sign-in-form'

interface SignInPageProps {
  searchParams: { verify?: string; callbackUrl?: string; error?: string }
}

async function submit(formData: FormData) {
  'use server'
  const email = String(formData.get('email') ?? '').trim()
  if (!email) return
  await signIn('nodemailer', { email, redirectTo: '/' })
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const session = await auth()
  if (session?.user?.id) redirect('/')

  const verifyMode = searchParams.verify === '1'
  const error = searchParams.error

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6">
      <div className="w-full space-y-6">
        <header className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">Multi-Agent Platform</h1>
          <p className="text-sm text-neutral-600">Sign in with a magic link.</p>
        </header>

        {verifyMode ? (
          <div className="rounded-md border border-neutral-200 bg-white p-4 text-sm text-neutral-700">
            Check your email for the sign-in link. In dev with no email server configured, the link
            is logged to the server console.
          </div>
        ) : (
          <SignInForm action={submit} error={error} />
        )}
      </div>
    </main>
  )
}

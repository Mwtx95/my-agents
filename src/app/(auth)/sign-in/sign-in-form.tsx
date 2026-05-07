'use client'

import { useFormStatus } from 'react-dom'

interface SignInFormProps {
  action: (formData: FormData) => Promise<void>
  error?: string
}

export function SignInForm({ action, error }: SignInFormProps) {
  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-neutral-700">Email</span>
        <input
          name="email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          placeholder="you@example.com"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
        />
      </label>

      {error ? (
        <p className="text-sm text-red-600">
          Sign-in failed: {error}. Try again, or check the server logs.
        </p>
      ) : null}

      <SubmitButton />
    </form>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Sending link…' : 'Send magic link'}
    </button>
  )
}

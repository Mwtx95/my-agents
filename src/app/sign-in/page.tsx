/**
 * Stub sign-in page for PR 1. The real form lands in PR 2 alongside the
 * authenticated app shell. Auth.js itself is wired up so the API route works.
 */
export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Multi-Agent Platform</h1>
      <p className="text-sm text-neutral-600">
        Sign-in is wired through Auth.js but the form ships in PR 2. For now you can verify the
        backend with{' '}
        <a className="underline" href="/api/health">
          /api/health
        </a>
        .
      </p>
    </main>
  )
}

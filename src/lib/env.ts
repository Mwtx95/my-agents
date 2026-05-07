import { z } from 'zod'

const llmProviderSchema = z.enum(['mock', 'minimax']).default('mock')

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().url(),

  AUTH_SECRET: z.string().min(1, 'AUTH_SECRET is required'),
  AUTH_EMAIL_FROM: z.string().email().optional().or(z.literal('')),
  AUTH_RESEND_API_KEY: z.string().optional(),
  AUTH_EMAIL_SERVER: z.string().optional(),

  LLM_PROVIDER: llmProviderSchema,
  MINIMAX_API_KEY: z.string().optional(),
  MINIMAX_BASE_URL: z.string().url().default('https://api.minimax.io/anthropic'),
  MINIMAX_MODEL: z.string().default('MiniMax-M2.7'),

  ENCRYPTION_KEY: z.string().optional(),

  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
})

const envSchema = baseSchema.superRefine((data, ctx) => {
  // MiniMax key only required when explicitly selected.
  if (data.LLM_PROVIDER === 'minimax' && !data.MINIMAX_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MINIMAX_API_KEY'],
      message: 'MINIMAX_API_KEY is required when LLM_PROVIDER=minimax',
    })
  }
})

export type Env = z.infer<typeof envSchema>

function parseEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(input)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment variables:\n${issues}`)
  }
  return parsed.data
}

/**
 * Exposed as a getter so tests can mutate `process.env` and re-import,
 * and so the validation error surfaces only when env is first read.
 */
let cached: Env | undefined
export const env = new Proxy({} as Env, {
  get(_target, key: string) {
    cached ??= parseEnv()
    return cached[key as keyof Env]
  },
})

/** Used by tests. */
export function _resetEnvCache(): void {
  cached = undefined
}

/** Used by tests to validate a custom env object. */
export const _envSchema = envSchema

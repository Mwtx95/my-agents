import { describe, expect, it } from 'vitest'

import { _envSchema } from '@/lib/env'

const baseEnv = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/agents',
  AUTH_SECRET: 'test-secret',
}

describe('env schema', () => {
  it('accepts a minimal valid environment with mock provider as the default', () => {
    const result = _envSchema.safeParse(baseEnv)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.LLM_PROVIDER).toBe('mock')
      expect(result.data.MINIMAX_BASE_URL).toBe('https://api.minimax.io/anthropic')
      expect(result.data.MINIMAX_MODEL).toBe('MiniMax-M2.7')
      expect(result.data.NODE_ENV).toBe('development')
    }
  })

  it('rejects a missing DATABASE_URL', () => {
    const { DATABASE_URL: _omit, ...rest } = baseEnv
    const result = _envSchema.safeParse(rest)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('DATABASE_URL'))).toBe(true)
    }
  })

  it('rejects a missing AUTH_SECRET', () => {
    const { AUTH_SECRET: _omit, ...rest } = baseEnv
    const result = _envSchema.safeParse(rest)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('AUTH_SECRET'))).toBe(true)
    }
  })

  it('rejects an unsupported LLM_PROVIDER', () => {
    const result = _envSchema.safeParse({ ...baseEnv, LLM_PROVIDER: 'gpt-99' })
    expect(result.success).toBe(false)
  })

  it('requires MINIMAX_API_KEY when LLM_PROVIDER=minimax', () => {
    const result = _envSchema.safeParse({ ...baseEnv, LLM_PROVIDER: 'minimax' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('MINIMAX_API_KEY'))).toBe(true)
    }
  })

  it('accepts LLM_PROVIDER=minimax with a key set', () => {
    const result = _envSchema.safeParse({
      ...baseEnv,
      LLM_PROVIDER: 'minimax',
      MINIMAX_API_KEY: 'mm_xyz',
    })
    expect(result.success).toBe(true)
  })

  it('treats AUTH_EMAIL_FROM as optional and accepts an empty string', () => {
    const result = _envSchema.safeParse({ ...baseEnv, AUTH_EMAIL_FROM: '' })
    expect(result.success).toBe(true)
  })

  it('rejects a malformed AUTH_EMAIL_FROM', () => {
    const result = _envSchema.safeParse({ ...baseEnv, AUTH_EMAIL_FROM: 'not-an-email' })
    expect(result.success).toBe(false)
  })

  it('rejects a malformed DATABASE_URL', () => {
    const result = _envSchema.safeParse({ ...baseEnv, DATABASE_URL: 'just-a-string' })
    expect(result.success).toBe(false)
  })
})

import { env } from '@/lib/env'
import type { LLMProvider } from './types'
import { MockLLMProvider } from './providers/mock'
import { MiniMaxProvider } from './providers/minimax'

export * from './types'

let cached: LLMProvider | undefined

export function getLLMProvider(): LLMProvider {
  if (cached) return cached

  switch (env.LLM_PROVIDER) {
    case 'minimax': {
      if (!env.MINIMAX_API_KEY) {
        // Validated at env parse time, but defend in depth here too.
        throw new Error('MINIMAX_API_KEY is required when LLM_PROVIDER=minimax')
      }
      cached = new MiniMaxProvider({
        apiKey: env.MINIMAX_API_KEY,
        baseURL: env.MINIMAX_BASE_URL,
        defaultModel: env.MINIMAX_MODEL,
      })
      return cached
    }
    case 'mock':
    default:
      cached = new MockLLMProvider()
      return cached
  }
}

/** Used by tests to swap providers between cases. */
export function _resetLLMProviderCache(): void {
  cached = undefined
}

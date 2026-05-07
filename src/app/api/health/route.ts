import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'

import { db } from '@/db'
import { getLLMProvider } from '@/lib/llm'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

interface HealthResponse {
  status: 'ok' | 'error'
  db: 'ok' | 'error'
  llm: 'ok' | 'error'
}

export async function GET(): Promise<NextResponse<HealthResponse>> {
  const [dbStatus, llmStatus] = await Promise.all([checkDb(), checkLlm()])
  const status: 'ok' | 'error' = dbStatus === 'ok' && llmStatus === 'ok' ? 'ok' : 'error'
  return NextResponse.json(
    { status, db: dbStatus, llm: llmStatus },
    { status: status === 'ok' ? 200 : 503 },
  )
}

async function checkDb(): Promise<'ok' | 'error'> {
  try {
    await db.execute(sql`select 1`)
    return 'ok'
  } catch (err) {
    logger.error({ err }, 'Health check: db failed')
    return 'error'
  }
}

async function checkLlm(): Promise<'ok' | 'error'> {
  try {
    const provider = getLLMProvider()
    const controller = new AbortController()
    const stream = provider.chat({
      systemPrompt: 'health check',
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 1,
      signal: controller.signal,
    })
    // Consume the first chunk to verify the provider is producing output, then abort.
    for await (const _chunk of stream) {
      controller.abort()
      break
    }
    return 'ok'
  } catch (err) {
    logger.error({ err }, 'Health check: llm failed')
    return 'error'
  }
}

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { agents } from '@/db/schema'
import { runAgent } from '@/lib/agents/runtime'
import { auth } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { notFound, toErrorResponse, unauthorized, parseJsonBody } from '@/lib/api/errors'
import { SSE_HEADERS, sseEvent } from '@/lib/sse'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  conversationId: z.number().int().positive().nullable(),
  message: z.string().min(1, 'Message must not be empty').max(50_000),
})

export async function POST(
  req: Request,
  { params }: { params: { agentSlug: string } },
): Promise<Response> {
  try {
    const session = await auth()
    if (!session?.user?.id) throw unauthorized()
    const userId = session.user.id

    const agent = await db.query.agents.findFirst({
      where: eq(agents.slug, params.agentSlug),
    })
    if (!agent || !agent.enabled) throw notFound(`Agent "${params.agentSlug}" not found`)

    const body = await parseJsonBody(req, bodySchema)

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of runAgent({
            agent,
            userId,
            conversationId: body.conversationId,
            userMessage: body.message,
            tools: [],
            signal: req.signal,
          })) {
            if (chunk.type === 'done') {
              controller.enqueue(
                sseEvent('done', {
                  conversationId: chunk.conversationId,
                  messageId: chunk.messageId,
                }),
              )
            } else if (chunk.type === 'conversation_created') {
              controller.enqueue(sseEvent('conversation_created', chunk))
            } else {
              controller.enqueue(sseEvent('chunk', chunk))
            }
          }
        } catch (err) {
          logger.error({ err }, 'chat stream failed')
          controller.enqueue(
            sseEvent('chunk', {
              type: 'error',
              error: err instanceof Error ? err.message : 'Stream failed',
            }),
          )
        } finally {
          controller.close()
        }
      },
      cancel() {
        // Client disconnected; runAgent honors req.signal so its db writes
        // for the user message + agent_run still complete.
      },
    })

    return new Response(stream, { headers: SSE_HEADERS })
  } catch (err) {
    return toErrorResponse(err)
  }
}

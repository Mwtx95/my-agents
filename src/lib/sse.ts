/**
 * Tiny SSE helper. Encodes named events with a JSON payload as a UTF-8
 * Uint8Array suitable for `ReadableStreamDefaultController.enqueue()`.
 */
const encoder = new TextEncoder()

export function sseEvent(event: string, data: unknown): Uint8Array {
  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  return encoder.encode(`event: ${event}\ndata: ${payload}\n\n`)
}

export const SSE_HEADERS: HeadersInit = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
}

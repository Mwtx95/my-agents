import { NextResponse } from 'next/server'
import { ZodError, type ZodSchema } from 'zod'

import { logger } from '@/lib/logger'

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export function notFound(message = 'Not found'): HttpError {
  return new HttpError(404, message)
}

export function unauthorized(message = 'Unauthorized'): HttpError {
  return new HttpError(401, message)
}

export function forbidden(message = 'Forbidden'): HttpError {
  return new HttpError(403, message)
}

export function badRequest(message = 'Bad request', details?: unknown): HttpError {
  return new HttpError(400, message, details)
}

/**
 * Wraps a route handler so thrown errors map to JSON responses with the right
 * status code, and unexpected errors are logged but never leak details.
 */
export function withErrorHandler<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<Response>,
): (...args: TArgs) => Promise<Response> {
  return async (...args: TArgs) => {
    try {
      return await handler(...args)
    } catch (err) {
      return toErrorResponse(err)
    }
  }
}

export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json(
      {
        error: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
      { status: err.status },
    )
  }

  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: err.issues.map((i) => ({
          path: i.path.join('.'),
          code: i.code,
          message: i.message,
        })),
      },
      { status: 400 },
    )
  }

  logger.error({ err }, 'Unhandled error in API route')
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

/**
 * Parse a JSON body against a Zod schema. Throws HttpError(400) on failure
 * with the validation issues attached.
 */
export async function parseJsonBody<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw badRequest('Invalid JSON body')
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw badRequest(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  }
  return parsed.data
}

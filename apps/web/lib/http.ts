// Shared HTTP helpers for route handlers (SPEC §8).
//
// SERVER-ONLY. Responses follow the SPEC §8 envelope: `{ data }` on success,
// `{ error: { code, message } }` on failure. Keeping this in one place means
// every handler returns a uniform shape and login/auth errors stay generic.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AppError, RateLimitError } from '@/lib/errors';
import { logger } from '@/lib/log';

/** Success envelope: `{ data }`. */
export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init);
}

/** Error envelope: `{ error: { code, message } }`. */
export function jsonError(
  status: number,
  code: string,
  message: string,
  init?: ResponseInit,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { ...init, status });
}

/**
 * Map any thrown value to the SPEC §8 error envelope. Known {@link AppError}s
 * pass their status/code/message through (rate limits also emit `Retry-After`);
 * anything else becomes a generic 500 whose message reveals nothing — the real
 * error is logged (redacted) server-side, never returned to the client.
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof RateLimitError) {
    return jsonError(err.status, err.code, err.message, {
      headers: { 'Retry-After': String(err.retryAfterSec) },
    });
  }
  if (err instanceof AppError) {
    return jsonError(err.status, err.code, err.message);
  }
  logger.error({ err }, 'unhandled route error');
  return jsonError(500, 'INTERNAL', 'An unexpected error occurred.');
}

/**
 * Best-effort client IP for rate limiting / audit. Prefers `x-forwarded-for`
 * (first hop) then `x-real-ip`. Never trusted for authorization — only for
 * coarse limiting/telemetry.
 */
export function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() ?? 'unknown';
}

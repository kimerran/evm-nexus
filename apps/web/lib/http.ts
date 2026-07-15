// Shared HTTP helpers for route handlers (SPEC §8).
//
// SERVER-ONLY. Responses follow the SPEC §8 envelope: `{ data }` on success,
// `{ error: { code, message } }` on failure. Keeping this in one place means
// every handler returns a uniform shape and login/auth errors stay generic.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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

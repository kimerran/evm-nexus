// POST /api/auth/logout (SPEC §8.1).
//
// Revokes the current session server-side (marks the `Session` row revoked) and
// clears the cookie. Idempotent: calling it without a valid session still
// succeeds and clears any stale cookie.
import { jsonOk, toErrorResponse } from '@/lib/http';
import { clearSessionCookie, getSession, revokeSession } from '@/lib/auth/session';
import { requireCsrf } from '@/lib/auth/csrf';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Cookie-authenticated mutation → CSRF (double-submit + Origin) required.
  try {
    requireCsrf(req);
  } catch (err) {
    return toErrorResponse(err);
  }

  const session = await getSession();
  if (session) {
    await revokeSession(session.sid);
  }
  const res = jsonOk({ ok: true });
  clearSessionCookie(res);
  return res;
}

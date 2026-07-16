// GET /api/auth/session (SPEC §8.1).
//
// Returns `{ user }` for a valid session or 401 otherwise. Applies the sliding
// refresh: an active session near expiry gets a fresh token/expiry re-set on the
// cookie so continued use keeps the session alive without a full re-login.
import { jsonError, jsonOk } from '@/lib/http';
import { getSession, refreshSessionIfNeeded, setSessionCookie } from '@/lib/auth/session';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return jsonError(401, 'UNAUTHENTICATED', 'Not authenticated.');
  }

  const res = jsonOk({ user: session.user });

  const refreshed = await refreshSessionIfNeeded(session);
  if (refreshed) {
    setSessionCookie(res, refreshed.token, refreshed.expiresAt);
  }
  return res;
}

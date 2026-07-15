// POST /api/auth/change-password (SPEC §8.1, §12).
//
// Requires an authenticated session (re-checked here, not just in proxy.ts).
// Verifies the current password, stores a new argon2id hash, then ROTATES the
// current session (new sid + cookie) and REVOKES all OTHER sessions — so a
// password change kicks every other device/stolen-cookie out while keeping the
// acting device signed in. Returns 204.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getClientIp, jsonError, toErrorResponse } from '@/lib/http';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import {
  getSession,
  revokeOtherSessions,
  rotateSession,
  setSessionCookie,
} from '@/lib/auth/session';
import { requireCsrf } from '@/lib/auth/csrf';

export const dynamic = 'force-dynamic';

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(1024),
    newPassword: z.string().min(12, 'New password must be at least 12 characters.').max(1024),
  })
  .strict();

export async function POST(req: NextRequest) {
  // Cookie-authenticated mutation → CSRF (double-submit + Origin) required.
  try {
    requireCsrf(req);
  } catch (err) {
    return toErrorResponse(err);
  }

  const session = await getSession();
  if (!session) {
    return jsonError(401, 'UNAUTHENTICATED', 'Not authenticated.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }

  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return jsonError(400, 'INVALID_BODY', first?.message ?? 'Invalid request body.');
  }
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || !user.isActive) {
    return jsonError(401, 'UNAUTHENTICATED', 'Not authenticated.');
  }

  const currentOk = await verifyPassword(user.passwordHash, currentPassword);
  if (!currentOk) {
    return jsonError(400, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect.');
  }

  const newHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });

  // Rotate this session (fresh sid) and revoke every other session for the user.
  const rotated = await rotateSession(session, {
    userAgent: req.headers.get('user-agent'),
    ip: getClientIp(req),
  });
  await revokeOtherSessions(user.id, rotated.sid);

  // 204: no body, but carry the rotated session cookie.
  const res = new NextResponse(null, { status: 204 });
  setSessionCookie(res, rotated.token, rotated.expiresAt);
  return res;
}

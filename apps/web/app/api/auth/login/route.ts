// POST /api/auth/login (SPEC §8.1, §12).
//
// Public, rate-limited. Generic errors only — NO user enumeration: an unknown
// username and a wrong password return the identical 401 and take the same time
// (we always run an argon2 verify, against a dummy hash when the user is
// missing). On success, mints a session and sets the signed, httpOnly,
// SameSite=Strict cookie.
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getClientIp, jsonError, jsonOk } from '@/lib/http';
import { DUMMY_PASSWORD_HASH, verifyPassword } from '@/lib/auth/password';
import { createSession, setSessionCookie } from '@/lib/auth/session';
import {
  checkLoginRateLimit,
  clearUsernameFailures,
  registerFailedLogin,
} from '@/lib/auth/rate-limit';
import { generateCsrfToken, setCsrfCookie } from '@/lib/auth/csrf';

export const dynamic = 'force-dynamic';

const loginSchema = z
  .object({
    username: z.string().min(1).max(256),
    password: z.string().min(1).max(1024),
  })
  .strict();

// Single generic failure response — identical for every rejected credential so
// nothing distinguishes "no such user" from "wrong password".
function invalidCredentials() {
  return jsonError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, 'INVALID_BODY', 'Invalid request body.');
  }
  const { username, password } = parsed.data;

  const ip = getClientIp(req);

  const limit = await checkLoginRateLimit(ip, username);
  if (!limit.allowed) {
    return jsonError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.', {
      headers: { 'Retry-After': String(limit.retryAfterSec) },
    });
  }

  const user = await prisma.user.findUnique({ where: { username } });

  // Always run a verify (constant work) so timing can't reveal user existence.
  const passwordOk = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, password);

  if (!user || !user.isActive || !passwordOk) {
    await registerFailedLogin(ip, username);
    return invalidCredentials();
  }

  const { token, expiresAt } = await createSession(user.id, user.role, {
    userAgent: req.headers.get('user-agent'),
    ip,
  });

  // Successful auth resets this user's failure counter.
  await clearUsernameFailures(username);

  const res = jsonOk({ user: { id: user.id, username: user.username, role: user.role } });
  setSessionCookie(res, token, expiresAt);
  // Issue a fresh CSRF token alongside the new session so subsequent cookie-authed
  // mutations (logout, change-password, …) have a double-submit token to echo.
  setCsrfCookie(res, generateCsrfToken());
  return res;
}

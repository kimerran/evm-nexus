// Session lifecycle: create / read / refresh / revoke (SPEC §12, AGENT.md §5).
//
// SERVER-ONLY. Bridges the pure token primitives (session-token.ts) to the
// `Session` table (via the shared Prisma singleton) and the request cookie jar.
// The cookie carries the signed JWS; the database carries only `sha256(sid)`
// plus expiry/revocation state, so a valid session requires BOTH a good
// signature AND a live, non-revoked row.
import type { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getEnv } from '@nexus/config/env';
import { prisma } from '@/lib/db';
import type { Role } from './role';
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  generateSid,
  hashSid,
  isSessionRecordValid,
  shouldRefreshSession,
  signSessionToken,
  verifySessionToken,
} from './session-token';

/** The authenticated user surface exposed to the app. Never carries the hash. */
export interface SessionUser {
  id: string;
  username: string;
  role: Role;
}

/** A resolved, still-valid session. */
export interface AuthSession {
  user: SessionUser;
  /** Opaque session id (for rotation / selective revocation of "other" sessions). */
  sid: string;
  expiresAt: Date;
}

/** Optional request metadata recorded on the session row (audit / forensics). */
export interface SessionRequestMeta {
  userAgent?: string | null;
  ip?: string | null;
}

function newExpiry(ttlSeconds: number = SESSION_TTL_SECONDS): Date {
  return new Date(Date.now() + ttlSeconds * 1000);
}

function cookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    // Secure only in production so login works locally over plain http.
    secure: getEnv().NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    expires: expiresAt,
  };
}

/**
 * Mint a new session for a user: generates a fresh `sid`, persists only its hash
 * with expiry, and returns the signed JWS to set as the cookie.
 */
export async function createSession(
  userId: string,
  role: Role,
  meta: SessionRequestMeta = {},
): Promise<{ token: string; sid: string; expiresAt: Date }> {
  const sid = generateSid();
  const expiresAt = newExpiry();

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSid(sid),
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
      expiresAt,
    },
  });

  const token = await signSessionToken({ userId, sid, role });
  return { token, sid, expiresAt };
}

/**
 * Resolve the current request's session from its cookie: verify the JWS, then
 * confirm a live, non-revoked `Session` row and an active user. Returns `null`
 * for any failure (no cookie, bad signature, expired, revoked, inactive user) —
 * callers must treat `null` as unauthenticated.
 */
export async function getSession(): Promise<AuthSession | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return null;

  const claims = await verifySessionToken(raw);
  if (!claims) return null;

  const record = await prisma.session.findUnique({
    where: { tokenHash: hashSid(claims.sid) },
    include: { user: true },
  });
  if (!record || !isSessionRecordValid(record)) return null;
  if (!record.user.isActive) return null;

  return {
    user: { id: record.user.id, username: record.user.username, role: record.user.role },
    sid: claims.sid,
    expiresAt: record.expiresAt,
  };
}

/**
 * Sliding refresh: if the session is close to expiry, extend the DB expiry and
 * return a freshly-signed token to re-set the cookie. Returns `null` when no
 * refresh is due (caller leaves the cookie untouched).
 */
export async function refreshSessionIfNeeded(
  session: AuthSession,
): Promise<{ token: string; expiresAt: Date } | null> {
  if (!shouldRefreshSession(session.expiresAt)) return null;

  const expiresAt = newExpiry();
  await prisma.session.update({
    where: { tokenHash: hashSid(session.sid) },
    data: { expiresAt },
  });
  const token = await signSessionToken({
    userId: session.user.id,
    sid: session.sid,
    role: session.user.role,
  });
  return { token, expiresAt };
}

/** Revoke a single session by its `sid` (idempotent; no-op if already gone). */
export async function revokeSession(sid: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashSid(sid), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revoke every OTHER active session for a user, keeping `keepSid` alive. Used on
 * password change so existing stolen sessions are invalidated while the actor
 * stays logged in on the current device. Returns the number revoked.
 */
export async function revokeOtherSessions(userId: string, keepSid: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null, tokenHash: { not: hashSid(keepSid) } },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** Rotate the current session's `sid` (revoke old row, mint new). Returns new token. */
export async function rotateSession(
  session: AuthSession,
  meta: SessionRequestMeta = {},
): Promise<{ token: string; sid: string; expiresAt: Date }> {
  await revokeSession(session.sid);
  return createSession(session.user.id, session.user.role, meta);
}

/** Set the signed session cookie on a response (httpOnly, SameSite=Strict). */
export function setSessionCookie(res: NextResponse, token: string, expiresAt: Date): void {
  res.cookies.set(SESSION_COOKIE_NAME, token, cookieOptions(expiresAt));
}

/** Clear the session cookie on a response (used on logout). */
export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE_NAME, '', { ...cookieOptions(new Date(0)), maxAge: 0 });
}

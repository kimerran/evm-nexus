// Session token primitives (SPEC §12, AGENT.md §5).
//
// SERVER-ONLY, but dependency-free (no Prisma, no next/headers) so it stays
// pure and unit-testable. Two independent secrets protect a session:
//
//   1. A random opaque `sid` carried INSIDE a jose-signed JWS (HS256, keyed by
//      SESSION_SECRET). The signature makes the cookie tamper-evident and the
//      `exp` claim bounds its lifetime.
//   2. Server-side revocation: only `sha256(sid)` is persisted in `Session`
//      (never the sid or the JWS itself), so a database dump cannot mint or
//      resurrect a session, and revocation is a single-row update.
//
// Verifying a cookie therefore requires BOTH the signing secret (to trust the
// JWS) and a live, non-revoked `Session` row (checked in session.ts).
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { getEnv } from '@nexus/config/env';
import type { Role } from './role';

/** Cookie name for the signed session JWS. */
export const SESSION_COOKIE_NAME = 'nexus_session';

/** Short session lifetime; refreshed on activity (sliding, see session.ts). */
export const SESSION_TTL_SECONDS = 60 * 30; // 30 minutes

/**
 * Sliding-refresh threshold: when a session has less than this many seconds of
 * its TTL remaining, activity re-issues a fresh token/expiry.
 */
export const SESSION_REFRESH_THRESHOLD_SECONDS = 60 * 15; // half of the TTL

/** Claims embedded in the signed session JWS. */
export interface SessionTokenClaims {
  /** User id (JWT `sub`). */
  userId: string;
  /** Opaque session id; only its hash is stored server-side. */
  sid: string;
  /** Role snapshot (authoritatively re-checked against the DB user). */
  role: Role;
}

function signingKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().SESSION_SECRET);
}

/** Generate a fresh, high-entropy opaque session id (256 bits, base64url). */
export function generateSid(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Hash a `sid` for server-side storage/lookup. SHA-256 is appropriate here: the
 * sid is a 256-bit random secret (not a low-entropy password), so a fast hash
 * gives no attacker advantage while keeping only a non-reversible token digest
 * in the database.
 */
export function hashSid(sid: string): string {
  return createHash('sha256').update(sid).digest('hex');
}

/**
 * Sign a session JWS valid for `ttlSeconds`. HS256 keyed by SESSION_SECRET.
 */
export function signSessionToken(
  claims: SessionTokenClaims,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ sid: claims.sid, role: claims.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + ttlSeconds)
    .sign(signingKey());
}

/**
 * Verify a session JWS: checks the HS256 signature and `exp`. Returns the claims
 * on success, or `null` for any invalid/tampered/expired/malformed token
 * (never throws — callers treat `null` uniformly as "no session").
 */
export async function verifySessionToken(jws: string): Promise<SessionTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(jws, signingKey(), { algorithms: ['HS256'] });
    const sid = payload.sid;
    const role = payload.role;
    if (
      typeof payload.sub !== 'string' ||
      typeof sid !== 'string' ||
      (role !== 'ADMIN' && role !== 'USER')
    ) {
      return null;
    }
    return { userId: payload.sub, sid, role };
  } catch {
    return null;
  }
}

/** True when a session row is currently usable: not revoked and not expired. */
export function isSessionRecordValid(
  session: { revokedAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
): boolean {
  if (session.revokedAt !== null) return false;
  return session.expiresAt.getTime() > now.getTime();
}

/** True when a still-valid session is close enough to expiry to warrant refresh. */
export function shouldRefreshSession(expiresAt: Date, now: Date = new Date()): boolean {
  const remainingMs = expiresAt.getTime() - now.getTime();
  return remainingMs < SESSION_REFRESH_THRESHOLD_SECONDS * 1000;
}

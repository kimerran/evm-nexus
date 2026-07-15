// CSRF protection: double-submit token + Origin check (SPEC §4.3/§13, AGENT.md §5).
//
// SERVER-ONLY. Two independent defenses on every cookie-authenticated mutation:
//
//   1. Double-submit token: a high-entropy token is set in a READABLE (non-
//      httpOnly) `nexus_csrf` cookie AND must be echoed back in the
//      `x-csrf-token` request header. A cross-site attacker can ride the
//      session cookie but cannot read the CSRF cookie (same-origin policy) nor
//      set a custom header on a cross-site form post, so it can't forge the
//      match. Compared in constant time.
//   2. Origin check: the request's `Origin` (or `Referer`) must match APP_URL.
//
// The session cookie is already `SameSite=Strict`; this is defense-in-depth on
// top of that (the spec asks for both).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@nexus/config/env';
import { CsrfError } from '@/lib/errors';

/** Readable (non-httpOnly) cookie carrying the CSRF token. */
export const CSRF_COOKIE_NAME = 'nexus_csrf';
/** Header the client must echo the token in. */
export const CSRF_HEADER_NAME = 'x-csrf-token';

/** Generate a fresh 256-bit CSRF token (base64url). */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

function cookieOptions() {
  return {
    // NON-httpOnly on purpose: the browser must read it to echo it in the header.
    httpOnly: false,
    secure: getEnv().NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
  };
}

/** Set/replace the CSRF cookie on a response. */
export function setCsrfCookie(res: NextResponse, token: string): void {
  res.cookies.set(CSRF_COOKIE_NAME, token, cookieOptions());
}

/**
 * Ensure the request carries a CSRF cookie; if absent, mint one and set it on
 * `res`. Returns the effective token. Call on safe (GET) navigations so a form
 * rendered later always has a token to submit.
 */
export function ensureCsrfCookie(req: NextRequest, res: NextResponse): string {
  const existing = req.cookies.get(CSRF_COOKIE_NAME)?.value;
  if (existing) return existing;
  const token = generateCsrfToken();
  setCsrfCookie(res, token);
  return token;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface CsrfCheckInput {
  /** Value of the request `Origin` header, if any. */
  origin: string | null;
  /** Value of the request `Referer` header, if any. */
  referer: string | null;
  /** The app's canonical origin (from APP_URL). */
  appOrigin: string;
  /** Token from the CSRF cookie. */
  cookieToken: string | null;
  /** Token echoed in the request header. */
  headerToken: string | null;
}

/**
 * Pure CSRF decision (unit-tested): passes only when BOTH the Origin/Referer
 * matches the app origin AND the cookie and header tokens are present and equal.
 */
export function checkCsrf(input: CsrfCheckInput): boolean {
  const { origin, referer, appOrigin, cookieToken, headerToken } = input;

  // Origin check. Prefer Origin; fall back to Referer's origin. Reject if neither
  // is present (a legitimate browser mutation always sends at least one).
  let sourceOrigin: string | null = origin;
  if (!sourceOrigin && referer) {
    try {
      sourceOrigin = new URL(referer).origin;
    } catch {
      sourceOrigin = null;
    }
  }
  if (!sourceOrigin || sourceOrigin !== appOrigin) return false;

  // Double-submit token check.
  if (!cookieToken || !headerToken) return false;
  return safeEqual(cookieToken, headerToken);
}

/** Verify CSRF on a NextRequest (Origin + double-submit). Returns a boolean. */
export function verifyCsrf(req: NextRequest): boolean {
  return checkCsrf({
    origin: req.headers.get('origin'),
    referer: req.headers.get('referer'),
    appOrigin: new URL(getEnv().APP_URL).origin,
    cookieToken: req.cookies.get(CSRF_COOKIE_NAME)?.value ?? null,
    headerToken: req.headers.get(CSRF_HEADER_NAME),
  });
}

/** Enforce CSRF on a mutation handler; throws {@link CsrfError} (→ 403) on failure. */
export function requireCsrf(req: NextRequest): void {
  if (!verifyCsrf(req)) throw new CsrfError();
}

// RBAC gate — call at the top of EVERY server action / route handler (SPEC §12).
//
// SERVER-ONLY. This is the authoritative authorization check. `proxy.ts` is only
// defense-in-depth (Next 16 has shipped proxy-bypass advisories), so every
// handler MUST re-check here. Authentication accepts either a session cookie OR
// a personal API key (`Authorization: Bearer nxs_…`); the pure {@link authorize}
// decision (principal.ts) compares the resolved role against the required one.
import type { NextRequest } from 'next/server';
import { getSession } from './session';
import type { Role } from './role';
import { parseApiKeyFromHeader, verifyApiKey } from './api-key';
import { authorize, type Principal } from './principal';
import { UnauthenticatedError } from '@/lib/errors';

export type { Principal } from './principal';

/**
 * Resolve the current caller from an API key (preferred when a `Bearer nxs_…`
 * header is present) or the session cookie. Returns `null` when unauthenticated.
 *
 * Security: a PRESENT-but-invalid API key returns `null` (rejected) rather than
 * falling back to the cookie — an explicit bad credential must never be silently
 * downgraded to another auth path.
 */
export async function resolvePrincipal(req?: NextRequest): Promise<Principal | null> {
  if (req) {
    const raw = parseApiKeyFromHeader(req.headers.get('authorization'));
    if (raw) {
      const principal = await verifyApiKey(raw);
      return principal ? { user: principal, via: 'api-key' } : null;
    }
  }
  const session = await getSession();
  if (session) return { user: session.user, via: 'session', sid: session.sid };
  return null;
}

/**
 * Require an authenticated caller with at least `required` role. Pass the
 * request to also honor API-key auth; omit it (server actions) for cookie-only.
 * Returns the {@link Principal} or throws (→ 401/403).
 */
export async function requireRole(required: Role, req?: NextRequest): Promise<Principal> {
  return authorize(await resolvePrincipal(req), required);
}

/** Require any authenticated caller (no specific role). */
export async function requireAuth(req?: NextRequest): Promise<Principal> {
  const principal = await resolvePrincipal(req);
  if (!principal) throw new UnauthenticatedError();
  return principal;
}

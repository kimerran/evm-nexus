// CSRF guard for mixed-auth mutations (SPEC §4.3/§13, AGENT.md §5).
//
// SERVER-ONLY. Routes that accept EITHER a session cookie OR a personal API key
// still need CSRF — but only on the cookie path. A `Authorization: Bearer nxs_…`
// key is not an ambient credential (a cross-site page can neither read it nor
// attach it), so CSRF does not apply to API-key callers; cookie-authenticated
// requests get the full double-submit + Origin check from lib/auth/csrf.
import type { NextRequest } from 'next/server';
import { parseApiKeyFromHeader } from './api-key';
import { requireCsrf } from './csrf';

/** Enforce CSRF unless the request authenticates with a Bearer API key. */
export function requireCsrfUnlessApiKey(req: NextRequest): void {
  if (parseApiKeyFromHeader(req.headers.get('authorization'))) return;
  requireCsrf(req);
}

'use client';

// Client-side CSRF helper (pairs with lib/auth/csrf.ts).
//
// The `nexus_csrf` cookie is readable (non-httpOnly) and seeded by proxy.ts on
// HTML navigations. On every cookie-authenticated mutation the browser must echo
// that token in the `x-csrf-token` header so the server's double-submit check
// passes. These names MUST stay in sync with CSRF_COOKIE_NAME / CSRF_HEADER_NAME
// (defined in lib/auth/csrf.ts, which is server-only — importing it here would
// pull node:crypto into the client bundle, so the constants are mirrored).
const CSRF_COOKIE_NAME = 'nexus_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';

/** Read the CSRF token from `document.cookie` (empty string when absent). */
export function readCsrfToken(): string {
  const match = new RegExp(`(?:^|;\\s*)${CSRF_COOKIE_NAME}=([^;]+)`).exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

/**
 * `fetch` wrapper for same-origin mutations: attaches the `x-csrf-token` header
 * and a JSON `Content-Type` (when a body is present and none was set) so cookie
 * auth + CSRF work without every call site repeating the boilerplate.
 */
export function csrfFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(CSRF_HEADER_NAME, readCsrfToken());
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(input, { ...init, headers, credentials: 'same-origin' });
}

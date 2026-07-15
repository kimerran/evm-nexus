import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session-token';
import { CSRF_COOKIE_NAME, generateCsrfToken } from '@/lib/auth/csrf';

/**
 * Next 16 middleware replacement (`proxy.ts`, not `middleware.ts`).
 *
 * Three jobs, all DEFENSE-IN-DEPTH — never the sole gate (Next has shipped
 * proxy-bypass advisories, so every route handler / RSC re-checks auth itself):
 *
 *  1. Strict security headers on every response, including a NONCE-BASED CSP
 *     with NO `unsafe-inline` for scripts. A per-request nonce is generated
 *     here, injected into the request headers so Next stamps it onto its own
 *     framework/hydration scripts, and echoed in the response CSP so the browser
 *     enforces it. `next/font` and Material Symbols use inline STYLES, which
 *     `style-src 'unsafe-inline'` permits (scripts stay nonce-only), so real
 *     pages render and hydrate cleanly.
 *  2. Auth gate: page navigations with no session cookie are redirected to
 *     /login (a cheap presence check — the JWS/DB check runs in the handler/RSC).
 *  3. CSRF cookie seeding: safe HTML navigations get a readable `nexus_csrf`
 *     cookie so a later form/fetch can echo it in the `x-csrf-token` header.
 */

// Paths that must stay reachable without a session cookie.
const PUBLIC_PATHS = ['/login'];

function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true; // root redirect target
  if (pathname.startsWith('/api')) return true; // handlers self-authorize
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function buildCsp(nonce: string, isProd: boolean): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // Dev/HMR (React Refresh / Turbopack) needs eval; production does not.
    isProd ? '' : "'unsafe-eval'",
  ]
    .filter(Boolean)
    .join(' ');

  const connectSrc = ["'self'", isProd ? '' : 'ws: wss:'].filter(Boolean).join(' ');

  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' https://fonts.gstatic.com data:`,
    // Inline STYLES only (next/font, Material Symbols) — never inline scripts.
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `script-src ${scriptSrc}`,
    `connect-src ${connectSrc}`,
    isProd ? 'upgrade-insecure-requests' : '',
  ].filter(Boolean);

  return directives.join('; ');
}

function applySecurityHeaders(response: NextResponse, csp: string): NextResponse {
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Harmless over http (browsers ignore it there); enforced once behind TLS.
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload',
  );
  return response;
}

function wantsHtml(request: NextRequest): boolean {
  return request.method === 'GET' && (request.headers.get('accept') ?? '').includes('text/html');
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const isProd = process.env.NODE_ENV === 'production';

  // Per-request nonce, propagated to the RSC render via a request header so Next
  // applies it to its framework scripts.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce, isProd);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  // Auth gate (defense-in-depth): missing session cookie → /login for app pages.
  if (!isPublicPath(pathname) && !request.cookies.has(SESSION_COOKIE_NAME)) {
    const loginUrl = new URL('/login', request.url);
    return applySecurityHeaders(NextResponse.redirect(loginUrl), csp);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  applySecurityHeaders(response, csp);

  // Seed a CSRF token on HTML navigations if the browser doesn't have one yet.
  if (wantsHtml(request) && !request.cookies.has(CSRF_COOKIE_NAME)) {
    response.cookies.set(CSRF_COOKIE_NAME, generateCsrfToken(), {
      httpOnly: false,
      secure: isProd,
      sameSite: 'strict',
      path: '/',
    });
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

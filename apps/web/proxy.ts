import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session-token';

/**
 * Next 16 middleware replacement (`proxy.ts`, not `middleware.ts`).
 *
 * Two jobs:
 *  1. Apply baseline security headers to every response.
 *  2. Defense-in-depth auth guard: redirect page navigations that carry NO
 *     session cookie to /login. This is a cheap presence check only — it does
 *     NOT verify the JWS or hit the DB. The authoritative session + role check
 *     runs in every route handler / RSC layout (AGENT.md §5, SPEC §12), because
 *     Next has shipped proxy-bypass advisories and the proxy must never be the
 *     sole gate.
 */
function applySecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
}

// Paths that must stay reachable without a session cookie.
const PUBLIC_PATHS = ['/login'];

function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true; // root redirect target
  if (pathname.startsWith('/api')) return true; // handlers self-authorize
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isPublicPath(pathname)) {
    const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);
    if (!hasSessionCookie) {
      const loginUrl = new URL('/login', request.url);
      return applySecurityHeaders(NextResponse.redirect(loginUrl));
    }
  }

  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

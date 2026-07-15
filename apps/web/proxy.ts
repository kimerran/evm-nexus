import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next 16 middleware replacement (`proxy.ts`, not `middleware.ts`). Applies
 * baseline security headers as defense-in-depth. This is NOT the sole auth gate:
 * every server action / route handler re-checks session + RBAC (AGENT.md §5,
 * SPEC §12) — Next has shipped proxy-bypass advisories.
 */
export function proxy(_request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

import { NextResponse } from 'next/server';

// Railway health check target (SPEC §14). Marked dynamic so nothing is evaluated
// at build time.
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok', service: 'web' });
}

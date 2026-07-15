// GET /api/me — the current principal (SPEC §12).
//
// Authenticates via EITHER a session cookie OR a personal API key
// (`Authorization: Bearer nxs_…`) and returns who the caller is + how they
// authenticated. Auth is re-checked here in the handler (never relies on
// proxy.ts), so a spoofed proxy header can't manufacture a principal.
import type { NextRequest } from 'next/server';
import { jsonOk, toErrorResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const principal = await requireAuth(req);
    return jsonOk({ user: principal.user, via: principal.via });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/bombard/:id/resume — resume a paused run (SPEC §8.7).
import type { NextRequest } from 'next/server';
import { jsonOk, toErrorResponse, getClientIp } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { requireCsrfUnlessApiKey } from '@/lib/auth/mutation-guard';
import { applyBombardControl } from '@/lib/bombard/control';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireAuth(req);
    requireCsrfUnlessApiKey(req);
    const { id } = await ctx.params;
    const run = await applyBombardControl(principal.user.id, id, 'resume', getClientIp(req));
    return jsonOk({ run });
  } catch (err) {
    return toErrorResponse(err);
  }
}

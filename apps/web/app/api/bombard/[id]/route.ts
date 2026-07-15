// GET /api/bombard/:id — run status + counters (SPEC §8.7).
//
// Auth re-checked here. Scoped to the authenticated user — a foreign id reads as
// 404 (never leaks another user's run).
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { jsonOk, toErrorResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { NotFoundError } from '@/lib/errors';
import { toBombardRunView } from '@/lib/bombard/dto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireAuth(req);
    const { id } = await ctx.params;

    const row = await prisma.bombardRun.findUnique({ where: { id } });
    if (!row || row.userId !== principal.user.id) throw new NotFoundError('Bombard run not found.');

    return jsonOk({ run: toBombardRunView(row) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

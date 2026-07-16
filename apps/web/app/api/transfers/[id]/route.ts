// GET /api/transfers/:id — transfer detail + live status (SPEC §8.6).
//
// Auth re-checked here. Scoped to the authenticated user — a foreign id reads as
// 404 (never leaks another user's transfer). Next 16 route `params` is async.
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { jsonOk, toErrorResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { NotFoundError } from '@/lib/errors';
import { toTransferView } from '@/lib/transfers/dto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireAuth(req);
    const { id } = await ctx.params;

    const row = await prisma.transfer.findUnique({ where: { id } });
    if (!row || row.userId !== principal.user.id) {
      throw new NotFoundError('Transfer not found.');
    }

    return jsonOk({ transfer: toTransferView(row) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

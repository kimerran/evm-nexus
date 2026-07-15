// GET /api/bombard/:id/events — paginated per-tx events (SPEC §8.7).
//
// Auth re-checked here. Scoped to the authenticated user (foreign run → 404).
// Cursor pagination by descending createdAt/id; `limit` capped. Live progress is
// also available via the telemetry SSE `bombard` channel (§8.10).
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { jsonOk, toErrorResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { NotFoundError } from '@/lib/errors';
import { toBombardEventView } from '@/lib/bombard/dto';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 200;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireAuth(req);
    const { id } = await ctx.params;

    const run = await prisma.bombardRun.findUnique({ where: { id }, select: { userId: true } });
    if (!run || run.userId !== principal.user.id) throw new NotFoundError('Bombard run not found.');

    const params = new URL(req.url).searchParams;
    const rawLimit = Number(params.get('limit') ?? '50');
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), MAX_LIMIT) : 50;
    const cursor = params.get('cursor');

    const rows = await prisma.bombardEvent.findMany({
      where: { runId: id },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return jsonOk({
      events: page.map(toBombardEventView),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

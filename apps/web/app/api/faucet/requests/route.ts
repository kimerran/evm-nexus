// GET /api/faucet/requests — the caller's own faucet history (SPEC §8.4).
//
// Auth re-checked here. Scoped to the authenticated user so one caller can never
// read another's requests. Returns serializable views (wei as strings).
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { jsonOk, toErrorResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { toFaucetRequestView } from '@/lib/faucet/dto';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 100;

/** GET /api/faucet/requests — recent faucet requests for the current user. */
export async function GET(req: NextRequest) {
  try {
    const principal = await requireAuth(req);

    const rawLimit = Number(new URL(req.url).searchParams.get('limit') ?? '50');
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), MAX_LIMIT) : 50;

    const rows = await prisma.faucetRequest.findMany({
      where: { userId: principal.user.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        toAddress: true,
        amount: true,
        status: true,
        txHash: true,
        networkId: true,
        createdAt: true,
      },
    });

    return jsonOk({ requests: rows.map(toFaucetRequestView) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

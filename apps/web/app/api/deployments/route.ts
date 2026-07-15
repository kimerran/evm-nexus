// GET /api/deployments — the caller's own deployments (SPEC §8.5).
//
// Auth re-checked here. Scoped to the authenticated user so one caller can never
// read another's deployments. Optional filters: standard / status / networkId.
// Amounts + big numbers are serialized as strings (never floats/BigInt-in-JSON).
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { jsonOk, toErrorResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { toDeploymentView } from '@/lib/deployments/dto';
import type { Prisma } from '@/lib/generated/prisma/client';
import type { TokenStandard, TxStatus } from '@/lib/generated/prisma/enums';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 100;
const STANDARDS: readonly TokenStandard[] = ['ERC20', 'ERC721', 'ERC1155'];
const STATUSES: readonly TxStatus[] = [
  'PENDING',
  'BROADCAST',
  'CONFIRMING',
  'SUCCESS',
  'FAILED',
  'REJECTED',
];

export async function GET(req: NextRequest) {
  try {
    const principal = await requireAuth(req);
    const params = new URL(req.url).searchParams;

    const where: Prisma.DeploymentWhereInput = { userId: principal.user.id };

    const standard = params.get('standard');
    if (standard && (STANDARDS as readonly string[]).includes(standard)) {
      where.standard = standard as TokenStandard;
    }
    const status = params.get('status');
    if (status && (STATUSES as readonly string[]).includes(status)) {
      where.status = status as TxStatus;
    }
    const networkId = params.get('networkId');
    if (networkId) where.networkId = networkId;

    const rawLimit = Number(params.get('limit') ?? '50');
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), MAX_LIMIT) : 50;

    const rows = await prisma.deployment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return jsonOk({ deployments: rows.map(toDeploymentView) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

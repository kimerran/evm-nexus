// GET /api/transfers — the caller's own transfers (SPEC §8.6).
//
// Auth re-checked here. Scoped to the authenticated user so one caller can never
// read another's transfers. Optional filters: kind / status / networkId. Amounts
// are serialized as strings (never floats/BigInt-in-JSON).
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { jsonOk, toErrorResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { toTransferView } from '@/lib/transfers/dto';
import type { Prisma } from '@/lib/generated/prisma/client';
import type { TransferKind, TxStatus } from '@/lib/generated/prisma/enums';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 100;
const KINDS: readonly TransferKind[] = ['NATIVE', 'ERC20', 'ERC721', 'ERC1155'];
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

    const where: Prisma.TransferWhereInput = { userId: principal.user.id };

    const kind = params.get('kind');
    if (kind && (KINDS as readonly string[]).includes(kind)) {
      where.kind = kind as TransferKind;
    }
    const status = params.get('status');
    if (status && (STATUSES as readonly string[]).includes(status)) {
      where.status = status as TxStatus;
    }
    const networkId = params.get('networkId');
    if (networkId) where.networkId = networkId;

    const rawLimit = Number(params.get('limit') ?? '50');
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), MAX_LIMIT) : 50;

    const rows = await prisma.transfer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return jsonOk({ transfers: rows.map(toTransferView) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

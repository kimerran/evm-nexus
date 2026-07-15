// GET /api/smart-accounts — the caller's own smart accounts (SPEC §8.9).
//
// Auth re-checked here. Scoped to the authenticated user so one caller can never
// read another's accounts. `isDeployed` is reconciled against on-chain code on
// read (syncDeployment), so an account deployed implicitly by a sponsored UserOp
// shows as deployed without a separate watcher.
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { jsonOk, toErrorResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { getPublicClient } from '@/lib/chain/resolver';
import { toSmartAccountView, syncDeployment } from '@/lib/smart-wallets/dto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const principal = await requireAuth(req);
    const rows = await prisma.smartAccount.findMany({
      where: { userId: principal.user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    let synced = rows;
    try {
      const publicClient = await getPublicClient();
      synced = await syncDeployment(rows, publicClient);
    } catch {
      // A chain read failure must not break listing — return stored flags as-is.
    }

    return jsonOk({ smartAccounts: synced.map(toSmartAccountView) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/networks/:id/default — set the active/default network (SPEC §8.2).
//
// ADMIN-only + CSRF. Atomically demotes every other network so exactly one row
// stays `isDefault = true`; that active network is what the resolver binds all
// on-chain reads/writes to. Auth re-checked here (proxy.ts is defense-in-depth).
import type { NextRequest } from 'next/server';
import { jsonOk, toErrorResponse } from '@/lib/http';
import { requireRole } from '@/lib/auth/require-role';
import { requireCsrf } from '@/lib/auth/csrf';
import { setDefaultNetwork } from '@/lib/chain/network-service';
import { toNetworkDto } from '@/lib/chain/network-dto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('ADMIN', req);
    requireCsrf(req);
    const { id } = await params;

    // TODO(#6): auditLog.write('network.setDefault', { targetType: 'Network', targetId: id }).
    const network = await setDefaultNetwork(id);
    return jsonOk({ network: toNetworkDto(network) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

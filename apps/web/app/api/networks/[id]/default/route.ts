// POST /api/networks/:id/default — set the active/default network (SPEC §8.2).
//
// ADMIN-only + CSRF. Atomically demotes every other network so exactly one row
// stays `isDefault = true`; that active network is what the resolver binds all
// on-chain reads/writes to. Auth re-checked here (proxy.ts is defense-in-depth).
import type { NextRequest } from 'next/server';
import { getClientIp, jsonOk, toErrorResponse } from '@/lib/http';
import { requireRole } from '@/lib/auth/require-role';
import { requireCsrf } from '@/lib/auth/csrf';
import { setDefaultNetwork } from '@/lib/chain/network-service';
import { toNetworkDto } from '@/lib/chain/network-dto';
import { writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireRole('ADMIN', req);
    requireCsrf(req);
    const { id } = await params;

    const network = await setDefaultNetwork(id);
    // SPEC §13: audit every privileged action (changing the active network binds
    // all on-chain reads/writes to it).
    await writeAudit({
      actorId: principal.user.id,
      action: 'network.setDefault',
      target: { type: 'Network', id },
      ip: getClientIp(req),
    });
    return jsonOk({ network: toNetworkDto(network) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

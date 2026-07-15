// /api/networks — list (user) + create (admin) (SPEC §8.2).
//
// GET is available to any authenticated caller and returns RPC-secret-REDACTED
// DTOs. POST is ADMIN-only, CSRF-protected, and zod-validated server-side. Auth
// is re-checked here in every handler (proxy.ts is defense-in-depth only).
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { jsonOk, toErrorResponse } from '@/lib/http';
import { requireAuth, requireRole } from '@/lib/auth/require-role';
import { requireCsrf } from '@/lib/auth/csrf';
import { ValidationError } from '@/lib/errors';
import { createNetworkSchema } from '@/lib/chain/network-schema';
import { createNetwork } from '@/lib/chain/network-service';
import { toNetworkDto } from '@/lib/chain/network-dto';

export const dynamic = 'force-dynamic';

/** GET /api/networks — list all networks (secrets redacted). */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const networks = await prisma.network.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return jsonOk({ networks: networks.map(toNetworkDto) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /api/networks — create a network (ADMIN + CSRF). */
export async function POST(req: NextRequest) {
  try {
    await requireRole('ADMIN', req);
    requireCsrf(req);

    const body: unknown = await req.json().catch(() => null);
    const parsed = createNetworkSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
    }

    // TODO(#6): auditLog.write('network.create', { targetType: 'Network', targetId: created.id }).
    const created = await createNetwork(parsed.data);
    return jsonOk({ network: toNetworkDto(created) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

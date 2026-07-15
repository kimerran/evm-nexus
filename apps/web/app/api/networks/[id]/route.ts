// /api/networks/:id — get (user) + update/delete (admin) (SPEC §8.2).
//
// GET redacts RPC secrets. PATCH/DELETE are ADMIN-only + CSRF-protected. DELETE
// is guarded: the active/default network or one referenced by any record cannot
// be removed (network-service.assertNetworkDeletable → 409). Auth re-checked here.
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getClientIp, jsonOk, toErrorResponse } from '@/lib/http';
import { requireAuth, requireRole } from '@/lib/auth/require-role';
import { requireCsrf } from '@/lib/auth/csrf';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { updateNetworkSchema } from '@/lib/chain/network-schema';
import { deleteNetwork, updateNetwork } from '@/lib/chain/network-service';
import { toNetworkDto } from '@/lib/chain/network-dto';
import { writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/networks/:id — one network (secrets redacted). */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    await requireAuth(req);
    const { id } = await params;
    const network = await prisma.network.findUnique({ where: { id } });
    if (!network) throw new NotFoundError('Network not found.');
    return jsonOk({ network: toNetworkDto(network) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** PATCH /api/networks/:id — update fields (ADMIN + CSRF). */
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const principal = await requireRole('ADMIN', req);
    requireCsrf(req);
    const { id } = await params;

    const body: unknown = await req.json().catch(() => null);
    const parsed = updateNetworkSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
    }

    const updated = await updateNetwork(id, parsed.data);
    // SPEC §13: audit every privileged action. Record only which fields changed —
    // never the RPC secret value (stored encrypted at rest).
    await writeAudit({
      actorId: principal.user.id,
      action: 'network.update',
      target: { type: 'Network', id },
      metadata: { fields: Object.keys(parsed.data) },
      ip: getClientIp(req),
    });
    return jsonOk({ network: toNetworkDto(updated) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** DELETE /api/networks/:id — delete when unreferenced & not default (ADMIN + CSRF). */
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const principal = await requireRole('ADMIN', req);
    requireCsrf(req);
    const { id } = await params;

    await deleteNetwork(id);
    // SPEC §13: audit every privileged action.
    await writeAudit({
      actorId: principal.user.id,
      action: 'network.delete',
      target: { type: 'Network', id },
      ip: getClientIp(req),
    });
    return jsonOk({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

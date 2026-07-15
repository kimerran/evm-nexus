// DELETE /api/keypairs/[id] — remove a persisted keypair (SPEC §8.3).
//
// requireAuth + CSRF (cookie path). A user may delete only their OWN keypair; a
// keypair belonging to someone else is reported as 404, never revealed. This
// removes only the persisted encrypted blob + public metadata — there is no
// private key on the server to remove. Deletion is a hard delete of the row.
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getClientIp, jsonOk, toErrorResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { requireCsrfUnlessApiKey } from '@/lib/auth/mutation-guard';
import { writeAudit } from '@/lib/audit';
import { NotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireCsrfUnlessApiKey(req);
    const principal = await requireAuth(req);
    const { id } = await ctx.params;

    const keypair = await prisma.keypair.findUnique({ where: { id } });
    // Ownership folded into the 404 so foreign keypairs are never disclosed.
    if (!keypair || keypair.userId !== principal.user.id) {
      throw new NotFoundError('Keypair not found.');
    }

    await prisma.keypair.delete({ where: { id } });

    await writeAudit({
      actorId: principal.user.id,
      action: 'keypair.delete',
      target: { type: 'keypair', id: keypair.id },
      metadata: { label: keypair.label, address: keypair.address },
      ip: getClientIp(req),
    });

    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

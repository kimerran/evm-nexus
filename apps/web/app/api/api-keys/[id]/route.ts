// DELETE /api/api-keys/[id] — revoke a personal API key (SPEC §8.11).
//
// requireAuth + CSRF (cookie path). A user may revoke only their OWN keys (a key
// belonging to someone else is reported as 404, never revealed). Revocation is a
// soft delete (`revokedAt`), so a revoked key never authenticates again but the
// row remains for the audit trail. Audit metadata carries name + prefix only.
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

    const key = await prisma.apiKey.findUnique({ where: { id } });
    // Ownership check folded into the 404 so foreign keys are never disclosed.
    if (!key || key.userId !== principal.user.id) throw new NotFoundError('API key not found.');

    if (key.revokedAt === null) {
      await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
      await writeAudit({
        actorId: principal.user.id,
        action: 'apiKey.revoke',
        target: { type: 'apiKey', id: key.id },
        metadata: { name: key.name, prefix: key.prefix },
        ip: getClientIp(req),
      });
    }

    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

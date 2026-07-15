// POST /api/users/[id]/reset-password — ADMIN resets another user's password
// (SPEC §7 /settings/users, §8.11, §12).
//
// requireRole('ADMIN') + CSRF. Stores a fresh argon2id hash (lib/auth/password)
// and REVOKES all of the target user's sessions so the old password (and any
// stolen cookie) is dead immediately. Audit metadata carries NO password/hash.
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getClientIp, jsonOk, toErrorResponse } from '@/lib/http';
import { requireRole } from '@/lib/auth/require-role';
import { requireCsrfUnlessApiKey } from '@/lib/auth/mutation-guard';
import { hashPassword } from '@/lib/auth/password';
import { writeAudit } from '@/lib/audit';
import { NotFoundError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const resetSchema = z
  .object({
    newPassword: z.string().min(12, 'New password must be at least 12 characters.').max(1024),
  })
  .strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireCsrfUnlessApiKey(req);
    const principal = await requireRole('ADMIN', req);
    const { id } = await ctx.params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }
    const parsed = resetSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundError('User not found.');

    const passwordHash = await hashPassword(parsed.data.newPassword);
    await prisma.user.update({ where: { id }, data: { passwordHash } });

    // Kill every existing session for the target so the reset takes effect now.
    await prisma.session.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await writeAudit({
      actorId: principal.user.id,
      action: 'user.password_reset',
      target: { type: 'user', id: target.id },
      metadata: { targetUsername: target.username },
      ip: getClientIp(req),
    });

    return jsonOk({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

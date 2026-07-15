// PATCH /api/users/[id] — activate/deactivate or change role, ADMIN only
// (SPEC §7 /settings/users, §8.11, §12).
//
// requireRole('ADMIN') + CSRF (cookie path). Each applied change writes one audit
// row via the shared writer (lib/audit) — NEVER with secrets in metadata. Guards
// against an admin locking themselves out (no self-deactivate / self-demote).
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getClientIp, jsonOk, toErrorResponse } from '@/lib/http';
import { requireRole } from '@/lib/auth/require-role';
import { requireCsrfUnlessApiKey } from '@/lib/auth/mutation-guard';
import { writeAudit } from '@/lib/audit';
import { NotFoundError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    isActive: z.boolean().optional(),
    role: z.enum(['ADMIN', 'USER']).optional(),
  })
  .strict()
  .refine((d) => d.isActive !== undefined || d.role !== undefined, {
    message: 'Provide isActive and/or role to update.',
  });

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
    }
    const { isActive, role } = parsed.data;

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundError('User not found.');

    // Self-lockout guard: an admin cannot deactivate or demote their own account.
    if (target.id === principal.user.id) {
      if (isActive === false) throw new ValidationError('You cannot deactivate your own account.');
      if (role === 'USER') throw new ValidationError('You cannot remove your own admin role.');
    }

    const data: { isActive?: boolean; role?: 'ADMIN' | 'USER' } = {};
    if (isActive !== undefined && isActive !== target.isActive) data.isActive = isActive;
    if (role !== undefined && role !== target.role) data.role = role;

    if (Object.keys(data).length === 0) {
      // Nothing actually changed — return current state without an audit row.
      return jsonOk({ user: publicUser(target) });
    }

    const updated = await prisma.user.update({ where: { id }, data });
    const ip = getClientIp(req);

    if (data.isActive !== undefined) {
      await writeAudit({
        actorId: principal.user.id,
        action: data.isActive ? 'user.activate' : 'user.deactivate',
        target: { type: 'user', id: updated.id },
        metadata: { targetUsername: updated.username },
        ip,
      });
    }
    if (data.role !== undefined) {
      await writeAudit({
        actorId: principal.user.id,
        action: 'user.role_change',
        target: { type: 'user', id: updated.id },
        metadata: { targetUsername: updated.username, from: target.role, to: data.role },
        ip,
      });
    }

    return jsonOk({ user: publicUser(updated) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function publicUser(u: {
  id: string;
  username: string;
  role: 'ADMIN' | 'USER';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

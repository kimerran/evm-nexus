// GET /api/users — list users, ADMIN only (SPEC §7 /settings/users, §8.11).
//
// RBAC re-checked here (`requireRole('ADMIN', req)`) independent of proxy.ts. The
// select is explicit and NEVER includes `passwordHash` — the digest never leaves
// the database.
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { jsonOk, toErrorResponse } from '@/lib/http';
import { requireRole } from '@/lib/auth/require-role';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireRole('ADMIN', req);

    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        username: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return jsonOk({ users });
  } catch (err) {
    return toErrorResponse(err);
  }
}

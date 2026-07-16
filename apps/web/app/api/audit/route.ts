// GET /api/audit — paginated audit log, ADMIN only (SPEC §8.11).
//
// Demonstrates + enforces RBAC: `requireRole('ADMIN', req)` re-checks the
// caller's role server-side (session cookie OR API key). A USER caller gets 403,
// an unauthenticated caller 401 — independent of proxy.ts. Query is zod-validated
// and rejects unknown keys.
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { jsonOk, toErrorResponse } from '@/lib/http';
import { requireRole } from '@/lib/auth/require-role';
import { ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const querySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export async function GET(req: NextRequest) {
  try {
    await requireRole('ADMIN', req);

    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams.entries()),
    );
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters.');
    }
    const { limit, cursor } = parsed.data;

    const logs = await prisma.auditLog.findMany({
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
      // Join the actor's username for the viewer; the row itself never carries
      // secrets, so this stays safe to surface.
      include: { user: { select: { username: true } } },
    });

    const nextCursor = logs.length === limit ? (logs.at(-1)?.id ?? null) : null;
    return jsonOk({ logs, nextCursor });
  } catch (err) {
    return toErrorResponse(err);
  }
}

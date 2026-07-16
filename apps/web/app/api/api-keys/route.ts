// GET/POST /api/api-keys — list (masked) / issue personal API keys (SPEC §8.11).
//
// requireAuth (session OR API key). Only HASHES are stored (lib/auth/api-key):
// the raw `nxs_…` token is returned exactly ONCE by POST and never persisted or
// logged. Listing exposes only the display `prefix`, never the hash. Keys are
// scoped to the issuing user; a new key inherits that user's live role at auth
// time. POST is a mutation → CSRF on the cookie path. Every issue is audited
// (metadata carries name + prefix only — never the raw token or hash).
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getClientIp, jsonOk, toErrorResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { requireCsrfUnlessApiKey } from '@/lib/auth/mutation-guard';
import { generateApiKey } from '@/lib/auth/api-key';
import { writeAudit } from '@/lib/audit';
import { ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

// Public (masked) shape of a key — NEVER includes keyHash.
const keySelect = {
  id: true,
  name: true,
  prefix: true,
  lastUsedAt: true,
  expiresAt: true,
  createdAt: true,
  revokedAt: true,
} as const;

const createSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.').max(64),
    expiresInDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();

export async function GET(req: NextRequest) {
  try {
    const principal = await requireAuth(req);
    const keys = await prisma.apiKey.findMany({
      where: { userId: principal.user.id },
      orderBy: { createdAt: 'desc' },
      select: keySelect,
    });
    return jsonOk({ keys });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireCsrfUnlessApiKey(req);
    const principal = await requireAuth(req);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
    }
    const { name, expiresInDays } = parsed.data;

    const { token, keyHash, prefix } = generateApiKey();
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const created = await prisma.apiKey.create({
      data: { userId: principal.user.id, name, keyHash, prefix, expiresAt },
      select: keySelect,
    });

    await writeAudit({
      actorId: principal.user.id,
      action: 'apiKey.issue',
      target: { type: 'apiKey', id: created.id },
      metadata: { name: created.name, prefix: created.prefix },
      ip: getClientIp(req),
    });

    // `token` is the ONLY time the raw key is ever returned. Shown once, then gone.
    return jsonOk({ key: created, token }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

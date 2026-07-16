// GET/POST /api/keypairs — list / persist non-custodial keypairs (SPEC §8.3).
//
// PRIME DIRECTIVE (AGENT.md §0): the server never custodies a private key. POST
// persists ONLY an opt-in, opaque encrypted keystore blob (label + public
// address + ciphertext envelope) that the server cannot decrypt. Any payload
// carrying private-key material is rejected 400 by a recursive denylist scan
// PLUS `.strict()` zod validation (a raw keystore missing its ciphertext also
// fails). requireAuth + CSRF (cookie path). Keypairs are scoped to the caller.
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getClientIp, jsonOk, toErrorResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { requireCsrfUnlessApiKey } from '@/lib/auth/mutation-guard';
import { writeAudit } from '@/lib/audit';
import { ConflictError, ValidationError } from '@/lib/errors';
import { assertNoPrivateKeyMaterial, createKeypairSchema } from '@/lib/keypairs/schema';
import { toKeypairDto } from '@/lib/keypairs/dto';
import type { Prisma } from '@/lib/generated/prisma/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const principal = await requireAuth(req);
    const rows = await prisma.keypair.findMany({
      where: { userId: principal.user.id },
      orderBy: { createdAt: 'desc' },
    });
    return jsonOk({ keypairs: rows.map(toKeypairDto) });
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

    // Layer 1: explicit denylist scan — reject ANY private-key-ish field, at any
    // depth, before we even parse the shape (prime directive, defense-in-depth).
    assertNoPrivateKeyMaterial(body);

    // Layer 2: strict shape validation — unknown keys rejected; encryptedKeystore
    // must be a real v3 ciphertext envelope.
    const parsed = createKeypairSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
    }
    const { label, address, encryptedKeystore } = parsed.data;

    let created;
    try {
      created = await prisma.keypair.create({
        data: {
          userId: principal.user.id,
          label,
          address,
          // Persisted rows are, by definition, NOT ephemeral.
          isEphemeral: false,
          encryptedKeystore: encryptedKeystore as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      // @@unique([userId, address]) — the same address persisted twice.
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
        throw new ConflictError('This address is already saved to your vault.');
      }
      throw err;
    }

    // Audit carries the public address + label ONLY — never key material.
    await writeAudit({
      actorId: principal.user.id,
      action: 'keypair.persist',
      target: { type: 'keypair', id: created.id },
      metadata: { label: created.label, address: created.address },
      ip: getClientIp(req),
    });

    return jsonOk({ keypair: toKeypairDto(created) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/keypairs/validate-address — checksum / validity (SPEC §8.3).
//
// requireAuth + CSRF (cookie path). Pure address utility: no key material is
// involved. Returns the EIP-55 checksummed form when valid, `{ valid: false }`
// otherwise. Never throws on a bad address — an invalid address is a normal 200
// result, not an error.
import type { NextRequest } from 'next/server';
import { getAddress, isAddress } from 'viem';
import { jsonOk, toErrorResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { requireCsrfUnlessApiKey } from '@/lib/auth/mutation-guard';
import { ValidationError } from '@/lib/errors';
import { validateAddressSchema } from '@/lib/keypairs/schema';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    requireCsrfUnlessApiKey(req);
    await requireAuth(req);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }
    const parsed = validateAddressSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
    }

    const { address } = parsed.data;
    if (!isAddress(address)) {
      return jsonOk({ valid: false, address: null });
    }
    return jsonOk({ valid: true, address: getAddress(address) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

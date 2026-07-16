// POST /api/faucet/request — enqueue a native-token drip (SPEC §8.4, AGENT.md §5).
//
// Auth + CSRF re-checked here (proxy.ts is defence-in-depth only). Every input is
// zod-validated and the address/amount normalized. Ceilings are enforced TWICE:
// a fast pre-check here (short-window rate limit + the pure policy against the
// active network + current usage) and again atomically in the drip worker under
// a Redis lock. The operator signer key is NEVER touched on this path — we only
// persist a QUEUED FaucetRequest and enqueue its id. Amounts stay bigint/wei.
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { jsonOk, toErrorResponse, getClientIp } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { requireCsrfUnlessApiKey } from '@/lib/auth/mutation-guard';
import { ValidationError, RateLimitError } from '@/lib/errors';
import { writeAudit } from '@/lib/audit';
import { RATE_LIMITS, consumeRateLimit, rateLimitKey } from '@/lib/rate-limit';
import { faucetRequestSchema } from '@/lib/faucet/schema';
import {
  resolveActiveFaucetNetwork,
  isFaucetGloballyEnabled,
  loadFaucetUsage,
} from '@/lib/faucet/context';
import { evaluateFaucetRequest } from '@/lib/faucet/policy';
import { faucetRejectToError } from '@/lib/faucet/reject';
import { enqueueFaucetDrip } from '@/lib/queue/faucet-queue';

export const dynamic = 'force-dynamic';

/** Short-window abuse guard keyed per address, IP, and user (SPEC §8.4). */
async function enforceRateLimit(address: string, ip: string, userId: string): Promise<void> {
  const results = await Promise.all([
    consumeRateLimit(rateLimitKey('faucet', 'addr', address), RATE_LIMITS.faucet),
    consumeRateLimit(rateLimitKey('faucet', 'ip', ip), RATE_LIMITS.faucet),
    consumeRateLimit(rateLimitKey('faucet', 'user', userId), RATE_LIMITS.faucet),
  ]);
  const blocked = results.find((r) => !r.allowed);
  if (blocked) {
    throw new RateLimitError(blocked.retryAfterSec, 'Too many faucet requests. Slow down.');
  }
}

/** POST /api/faucet/request — validate, gate, persist QUEUED, enqueue drip. */
export async function POST(req: NextRequest) {
  try {
    const principal = await requireAuth(req);
    requireCsrfUnlessApiKey(req);

    const body: unknown = await req.json().catch(() => null);
    const parsed = faucetRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
    }
    const { toAddress, amount, networkId } = parsed.data;
    const requestedWei = BigInt(amount);
    const ip = getClientIp(req);

    await enforceRateLimit(toAddress, ip, principal.user.id);

    const network = await resolveActiveFaucetNetwork(networkId);
    const globallyEnabled = await isFaucetGloballyEnabled();
    const usage = await loadFaucetUsage(network.id, toAddress, network.cooldownSec);

    const decision = evaluateFaucetRequest({
      enabled: network.faucetEnabled && globallyEnabled,
      requestedWei,
      perRequestCapWei: network.dripWei,
      dailyCapWei: network.dailyCapWei,
      dailyUsedWei: usage.dailyUsedWei,
      cooldownActive: usage.cooldownActive,
    });
    if (!decision.ok) {
      throw faucetRejectToError(decision.code, decision.message, network.cooldownSec);
    }

    // Persist PENDING (the DB's queued state — TxStatus has no QUEUED) so the
    // worker's idempotency gate accepts it, then hand off only the row id. The
    // API response reports "QUEUED" per SPEC §8.4.
    const request = await prisma.faucetRequest.create({
      data: {
        userId: principal.user.id,
        networkId: network.id,
        toAddress,
        amount, // wei string at rest
        ip,
        status: 'PENDING',
      },
      select: { id: true },
    });

    await enqueueFaucetDrip(request.id);

    // Audit — NEVER secrets; amount is a public wei string, not a key.
    await writeAudit({
      actorId: principal.user.id,
      action: 'faucet.request',
      target: { type: 'FaucetRequest', id: request.id },
      metadata: {
        networkId: network.id,
        chainId: network.chainId,
        toAddress,
        amountWei: amount,
      },
      ip,
    });

    return jsonOk({ requestId: request.id, status: 'QUEUED' }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

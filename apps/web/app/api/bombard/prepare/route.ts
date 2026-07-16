// POST /api/bombard/prepare — validate ceilings + stage a run (SPEC §8.7, AGENT §5).
//
// Auth + CSRF re-checked here. zod-validates the request, resolves the ACTIVE
// network, verifies the live chainId, and enforces the HARD abuse ceilings
// (kill-switch, targetTps ≤ BOMBARD_MAX_TPS, totalCount ≤ BOMBARD_MAX_TOTAL,
// per-tx value ceiling, relayer allow-list). On success it creates a QUEUED
// BombardRun and — for CLIENT_SIGNED mode — returns the assigned nonce range +
// tx template for the client to BULK pre-sign, plus an HMAC-signed plan token
// that pins every execution parameter so /start can't be fed forged values.
// The private key never comes near the server.
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { jsonOk, toErrorResponse, getClientIp } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { requireCsrfUnlessApiKey } from '@/lib/auth/mutation-guard';
import { ValidationError, RateLimitError } from '@/lib/errors';
import { RATE_LIMITS, consumeRateLimit, rateLimitKey } from '@/lib/rate-limit';
import { writeAudit } from '@/lib/audit';
import { getPublicClient } from '@/lib/chain/resolver';
import { bombardPrepareSchema } from '@/lib/bombard/schema';
import { resolveActiveBombardNetwork } from '@/lib/bombard/context';
import { loadBombardCeilings } from '@/lib/bombard/ceilings';
import { evaluateBombardCeilings } from '@/lib/bombard/policy';
import { encodePlan, BOMBARD_PLAN_TTL_MS, type BombardPlan } from '@/lib/bombard/draft';
import type { BombardMode } from '@/lib/generated/prisma/enums';

export const dynamic = 'force-dynamic';

/** A native transfer is exactly 21000 gas — no estimate round-trip needed. */
const NATIVE_TRANSFER_GAS = 21_000n;

export async function POST(req: NextRequest) {
  try {
    const principal = await requireAuth(req);
    requireCsrfUnlessApiKey(req);

    const ip = getClientIp(req);
    const results = await Promise.all([
      consumeRateLimit(rateLimitKey('bombard', 'user', principal.user.id), RATE_LIMITS.bombard),
      consumeRateLimit(rateLimitKey('bombard', 'ip', ip), RATE_LIMITS.bombard),
    ]);
    const blocked = results.find((r) => !r.allowed);
    if (blocked) throw new RateLimitError(blocked.retryAfterSec, 'Too many bombard requests.');

    const body: unknown = await req.json().catch(() => null);
    const parsed = bombardPrepareSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
    }
    const request = parsed.data;

    const network = await resolveActiveBombardNetwork(request.networkId);
    const ceilings = await loadBombardCeilings();

    // HARD ceilings — kill-switch, tps, total, per-tx value, relayer allow-list.
    const verdict = evaluateBombardCeilings(
      {
        mode: request.mode,
        targetTps: request.targetTps,
        totalCount: request.totalCount,
        amountPerTxWei: request.amountPerTx,
        to: request.to,
      },
      ceilings,
    );
    if (!verdict.ok) throw new ValidationError(verdict.message);

    // Per-tx gas/fee ceilings (defence-in-depth beside the per-tx value ceiling).
    if (NATIVE_TRANSFER_GAS > ceilings.maxGasPerTx) {
      throw new ValidationError('Per-tx gas exceeds the bombard ceiling.');
    }

    // Confirm the live chain matches the configured one BEFORE staging anything.
    const publicClient = await getPublicClient();
    const liveChainId = await publicClient.getChainId();
    if (liveChainId !== network.chainId) {
      throw new ValidationError(
        `Active network chainId ${network.chainId} does not match the live RPC (${liveChainId}).`,
      );
    }

    // Fees off the latest block; a native transfer's gas is fixed at 21000.
    const block = await publicClient.getBlock({ blockTag: 'latest' });
    const baseFee = block.baseFeePerGas ?? 0n;
    let maxPriorityFeePerGas: bigint;
    try {
      maxPriorityFeePerGas = await publicClient.estimateMaxPriorityFeePerGas();
    } catch {
      maxPriorityFeePerGas = 1_000_000_000n; // 1 gwei fallback
    }
    const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;
    if (maxFeePerGas > ceilings.maxFeePerGasWei) {
      throw new ValidationError('Network fees exceed the bombard maxFeePerGas ceiling.');
    }

    // Assigned nonce range for the bulk pre-sign (pending count = next free nonce).
    const startNonce = await publicClient.getTransactionCount({
      address: request.from as `0x${string}`,
      blockTag: 'pending',
    });

    const run = await prisma.bombardRun.create({
      data: {
        userId: principal.user.id,
        networkId: network.id,
        mode: request.mode as BombardMode,
        targetTps: request.targetTps,
        totalCount: request.totalCount,
        fromAddress: request.from,
        toAddress: request.to,
        status: 'QUEUED',
      },
      select: { id: true },
    });

    const plan: BombardPlan = {
      v: 1,
      userId: principal.user.id,
      runId: run.id,
      networkId: network.id,
      chainId: network.chainId,
      mode: request.mode,
      from: request.from,
      to: request.to,
      amountPerTxWei: request.amountPerTx,
      startNonce,
      totalCount: request.totalCount,
      targetTps: request.targetTps,
      gas: NATIVE_TRANSFER_GAS.toString(),
      maxFeePerGasWei: maxFeePerGas.toString(),
      maxPriorityFeePerGasWei: maxPriorityFeePerGas.toString(),
      exp: Date.now() + BOMBARD_PLAN_TTL_MS,
    };
    const planToken = encodePlan(plan);

    const estimatedTotalGas = NATIVE_TRANSFER_GAS * BigInt(request.totalCount);

    await writeAudit({
      actorId: principal.user.id,
      action: 'bombard.prepare',
      target: { type: 'BombardRun', id: run.id },
      metadata: {
        networkId: network.id,
        chainId: network.chainId,
        mode: request.mode,
        from: request.from,
        to: request.to,
        targetTps: request.targetTps,
        totalCount: request.totalCount,
        startNonce,
      },
      ip,
    });

    return jsonOk({
      runId: run.id,
      mode: request.mode,
      nonceRange: { startNonce, count: request.totalCount },
      template: {
        chainId: network.chainId,
        to: request.to,
        value: request.amountPerTx,
        gas: NATIVE_TRANSFER_GAS.toString(),
        maxFeePerGas: maxFeePerGas.toString(),
        maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
      },
      estimatedGasPerTx: NATIVE_TRANSFER_GAS.toString(),
      estimatedTotalGas: estimatedTotalGas.toString(),
      baseFee: baseFee.toString(),
      planToken,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

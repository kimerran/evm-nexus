// POST /api/bombard/start — enforce single-active + launch the runner (SPEC §8.7).
//
// Auth + CSRF re-checked here. The server receives ONLY raw SIGNED txs (client
// mode) or nothing (relayer mode) — never a private key. It verifies the HMAC-
// pinned plan (owner + run + expiry), re-checks the kill-switch and the ACTIVE
// network/chainId, validates a sample of the signed batch against the plan, then
// ATOMICALLY enforces per-user concurrency 1 (no other RUNNING/PAUSED run) while
// flipping this QUEUED run to RUNNING. Only then does it stage the plan + raw txs
// in Redis and enqueue `bombard-runner`.
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getRedis } from '@/lib/redis';
import { jsonOk, toErrorResponse, getClientIp } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { requireCsrfUnlessApiKey } from '@/lib/auth/mutation-guard';
import { ValidationError, ForbiddenError, ConflictError, NotFoundError, RateLimitError } from '@/lib/errors';
import { RATE_LIMITS, consumeRateLimit, rateLimitKey } from '@/lib/rate-limit';
import { writeAudit } from '@/lib/audit';
import { getPublicClient } from '@/lib/chain/resolver';
import { bombardStartSchema } from '@/lib/bombard/schema';
import { resolveActiveBombardNetwork } from '@/lib/bombard/context';
import { loadBombardCeilings } from '@/lib/bombard/ceilings';
import { evaluateBombardCeilings } from '@/lib/bombard/policy';
import { decodePlan } from '@/lib/bombard/draft';
import { verifyBombardBatch } from '@/lib/bombard/verify';
import { toBombardRunView } from '@/lib/bombard/dto';
import {
  bombardTxsKey,
  bombardPlanKey,
  bombardControlKey,
  type RunnerPlan,
} from '@/lib/bombard/keys';
import { enqueueBombardRun } from '@/lib/queue/bombard-queue';

export const dynamic = 'force-dynamic';

const PLAN_ERROR_MESSAGE: Record<string, string> = {
  malformed: 'Malformed bombard plan.',
  'bad-signature': 'Bombard plan failed verification.',
  expired: 'Bombard plan has expired — re-prepare and try again.',
};

export async function POST(req: NextRequest) {
  try {
    const principal = await requireAuth(req);
    requireCsrfUnlessApiKey(req);

    const ip = getClientIp(req);
    const rl = await consumeRateLimit(
      rateLimitKey('bombard', 'user', principal.user.id),
      RATE_LIMITS.bombard,
    );
    if (!rl.allowed) throw new RateLimitError(rl.retryAfterSec, 'Too many bombard requests.');

    const body: unknown = await req.json().catch(() => null);
    const parsed = bombardStartSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
    }
    const { runId, planToken, rawSignedTxs } = parsed.data;

    // Verify + decode the pinned plan (integrity, expiry, owner, run binding).
    const decoded = decodePlan(planToken);
    if (!decoded.ok) {
      throw new ValidationError(PLAN_ERROR_MESSAGE[decoded.error] ?? 'Invalid bombard plan.');
    }
    const plan = decoded.plan;
    if (plan.userId !== principal.user.id) {
      throw new ForbiddenError('This bombard plan belongs to another user.');
    }
    if (plan.runId !== runId) {
      throw new ValidationError('Bombard plan does not match the run id.');
    }

    const run = await prisma.bombardRun.findUnique({ where: { id: runId } });
    if (!run || run.userId !== principal.user.id) throw new NotFoundError('Bombard run not found.');
    if (run.status !== 'QUEUED') {
      throw new ConflictError(`Run is ${run.status} and cannot be started.`);
    }

    // Re-check the kill-switch + ceilings at start (they may have changed since prepare).
    const ceilings = await loadBombardCeilings();
    const verdict = evaluateBombardCeilings(
      {
        mode: plan.mode,
        targetTps: plan.targetTps,
        totalCount: plan.totalCount,
        amountPerTxWei: plan.amountPerTxWei,
        to: plan.to,
      },
      ceilings,
    );
    if (!verdict.ok) throw new ValidationError(verdict.message);

    // The pinned network must still be active and match the live chain.
    const network = await resolveActiveBombardNetwork(plan.networkId);
    if (network.id !== plan.networkId || network.chainId !== plan.chainId) {
      throw new ValidationError('The bombard plan targets a network that is no longer active.');
    }
    const publicClient = await getPublicClient();
    const liveChainId = await publicClient.getChainId();
    if (liveChainId !== plan.chainId) {
      throw new ValidationError(
        `Active network chainId ${plan.chainId} does not match the live RPC (${liveChainId}).`,
      );
    }

    // Mode-specific validation + staging of raw txs.
    if (plan.mode === 'CLIENT_SIGNED') {
      if (!rawSignedTxs || rawSignedTxs.length === 0) {
        throw new ValidationError('CLIENT_SIGNED runs require the bulk pre-signed txs.');
      }
      await verifyBombardBatch(rawSignedTxs, plan);
    } else if (rawSignedTxs && rawSignedTxs.length > 0) {
      throw new ValidationError('RELAYER runs must not include client-signed txs.');
    }

    // ATOMIC single-active guard: reject if the user has ANY other RUNNING/PAUSED
    // run, then flip THIS queued run to RUNNING inside the same transaction so two
    // concurrent starts can't both pass (the status flip is the race guard).
    await prisma.$transaction(async (tx) => {
      const otherActive = await tx.bombardRun.count({
        where: { userId: principal.user.id, id: { not: runId }, status: { in: ['RUNNING', 'PAUSED'] } },
      });
      if (otherActive > 0) {
        throw new ConflictError('You already have an active bombard run (concurrency limit is 1).');
      }
      const flipped = await tx.bombardRun.updateMany({
        where: { id: runId, userId: principal.user.id, status: 'QUEUED' },
        data: { status: 'RUNNING', startedAt: new Date() },
      });
      if (flipped.count !== 1) {
        throw new ConflictError('Run is no longer startable.');
      }
    });

    // Stage the trusted plan + raw txs for the worker; clear any stale control.
    const redis = getRedis();
    const runnerPlan: RunnerPlan = {
      mode: plan.mode,
      chainId: plan.chainId,
      from: plan.from,
      to: plan.to,
      amountPerTxWei: plan.amountPerTxWei,
      startNonce: plan.startNonce,
      totalCount: plan.totalCount,
      targetTps: plan.targetTps,
      gas: plan.gas,
      maxFeePerGasWei: plan.maxFeePerGasWei,
      maxPriorityFeePerGasWei: plan.maxPriorityFeePerGasWei,
    };
    await redis.del(bombardControlKey(runId));
    await redis.set(bombardPlanKey(runId), JSON.stringify(runnerPlan), 'EX', 24 * 60 * 60);
    if (plan.mode === 'CLIENT_SIGNED' && rawSignedTxs) {
      const txsKey = bombardTxsKey(runId);
      await redis.del(txsKey);
      // Push in nonce order; chunked so a very large batch doesn't build one huge command.
      const CHUNK = 1000;
      for (let i = 0; i < rawSignedTxs.length; i += CHUNK) {
        await redis.rpush(txsKey, ...rawSignedTxs.slice(i, i + CHUNK));
      }
      await redis.expire(txsKey, 24 * 60 * 60);
    }

    await enqueueBombardRun(runId, 'start');

    await writeAudit({
      actorId: principal.user.id,
      action: 'bombard.start',
      target: { type: 'BombardRun', id: runId },
      metadata: {
        networkId: network.id,
        chainId: network.chainId,
        mode: plan.mode,
        targetTps: plan.targetTps,
        totalCount: plan.totalCount,
      },
      ip,
    });

    const fresh = await prisma.bombardRun.findUnique({ where: { id: runId } });
    return jsonOk({ run: fresh ? toBombardRunView(fresh) : null }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

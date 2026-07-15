// bombard-runner processor — paced, cancellable, backpressure-aware tx emitter
// (SPEC §8.7/§9, AGENT.md §0/§5).
//
// Design:
//   • Concurrency 1 per user — a per-user Redis lock (refreshed while running)
//     serializes all of a user's runs; a job that can't take the lock requeues.
//   • Token-bucket pacing sized to `targetTps` — the emit stream converges on the
//     target rate. Backpressure (RPC 429/timeout) shrinks the bucket's rate and
//     backs off exponentially (REDUCE throughput, never fail the run); sustained
//     success recovers the rate toward target.
//   • Nonces — CLIENT_SIGNED mode broadcasts the pre-signed raw txs (nonces baked
//     in) staged in a Redis list; RELAYER mode signs with the operator key using
//     a locally-managed contiguous nonce (startNonce + index).
//   • Resume — sentCount is persisted; a resumed job continues from the last
//     nonce. Cancel/pause are observed via a fast Redis control signal.
//   • Secrets — the operator key lives ONLY here (relayer mode); logs carry only
//     ids / statuses / tx HASHES, never a key or a raw signed tx.
import type { Redis } from 'ioredis';
import { prisma } from '../lib/prisma';
import { getConnection } from '../lib/redis';
import {
  loadNetworkBasic,
  buildPublicClientForNetwork,
  buildRelayerClients,
} from '../lib/chain';
import { TELEMETRY_CHANNELS } from '../../apps/web/lib/telemetry/sse';
import type { BombardTelemetryEvent } from '../../apps/web/lib/bombard/bombard-event';
import { TokenBucket } from '../../apps/web/lib/bombard/token-bucket';
import {
  BackpressureController,
  isBackpressureError,
} from '../../apps/web/lib/bombard/backpressure';
import {
  bombardTxsKey,
  bombardPlanKey,
  bombardControlKey,
  bombardUserLockKey,
  type RunnerPlan,
} from '../../apps/web/lib/bombard/keys';

const LOCK_TTL_MS = 60_000;
const LOCK_REFRESH_MS = 20_000;
const CONTROL_POLL_MS = 200;
const FLUSH_MS = 500;

// Compare-and-extend: refresh our lock's TTL only while we still hold it.
const REFRESH_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
else
  return 0
end`;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)));

export interface BombardRunResult {
  runId: string;
  status: string;
  sentCount: number;
  successCount: number;
  failCount: number;
  note?: string;
}

/** A thrown RPC error whose message says the tx (nonce) is already on chain. */
function isAlreadyOnChain(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    m.includes('nonce too low') ||
    m.includes('already known') ||
    m.includes('known transaction') ||
    m.includes('already imported')
  );
}

/** Best-effort publish of a `bombard` telemetry event (never throws). */
async function publish(redis: Redis, event: BombardTelemetryEvent): Promise<void> {
  try {
    await redis.publish(TELEMETRY_CHANNELS.bombard, JSON.stringify(event));
  } catch {
    // Telemetry must never break the run.
  }
}

/**
 * Process one bombard-runner job. Safe to call repeatedly for the same id
 * (idempotent by persisted status + sentCount).
 */
export async function processBombardRun(runId: string): Promise<BombardRunResult> {
  const redis = getConnection();

  const run = await prisma.bombardRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error(`BombardRun ${runId} not found`);
  if (run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELLED') {
    return {
      runId,
      status: run.status,
      sentCount: run.sentCount,
      successCount: run.successCount,
      failCount: run.failCount,
      note: 'already-terminal',
    };
  }

  // Concurrency 1 per user: take the per-user lock, or requeue.
  const lockKey = bombardUserLockKey(run.userId);
  const lockToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const acquired = await redis.set(lockKey, lockToken, 'PX', LOCK_TTL_MS, 'NX');
  if (acquired !== 'OK') {
    throw new Error(`bombard user lock busy for ${run.userId}`);
  }

  let lastLockRefresh = Date.now();
  const refreshLock = async (now: number): Promise<void> => {
    if (now - lastLockRefresh < LOCK_REFRESH_MS) return;
    lastLockRefresh = now;
    await redis.eval(REFRESH_SCRIPT, 1, lockKey, lockToken, String(LOCK_TTL_MS));
  };

  // Local counters seed from the persisted run so a resume continues cleanly.
  let sent = run.sentCount;
  let success = run.successCount;
  let fail = run.failCount;
  const total = run.totalCount;

  let lastFlush = 0;
  const flush = async (status: string, finished = false): Promise<void> => {
    await prisma.bombardRun.update({
      where: { id: runId },
      data: {
        sentCount: sent,
        successCount: success,
        failCount: fail,
        ...(finished ? { finishedAt: new Date() } : {}),
      },
    });
    lastFlush = Date.now();
    await publish(redis, {
      runId,
      status,
      sentCount: sent,
      successCount: success,
      failCount: fail,
      totalCount: total,
      targetTps: run.targetTps,
      effectiveTps: Math.round(bucket.ratePerSec),
      at: new Date().toISOString(),
    });
  };

  // Fast control signal (pause/cancel) — polled at most every CONTROL_POLL_MS.
  let cachedControl: string | null = null;
  let lastControlPoll = 0;
  const readControl = async (now: number): Promise<string | null> => {
    if (now - lastControlPoll < CONTROL_POLL_MS) return cachedControl;
    lastControlPoll = now;
    cachedControl = await redis.get(bombardControlKey(runId));
    return cachedControl;
  };

  // Start EMPTY (startTokens = 0) so the emitted rate converges on targetTps with
  // no opening burst; the burst capacity is reserved for catch-up after a stall.
  const bucket = new TokenBucket(run.targetTps, Math.min(run.targetTps, 20), Date.now(), 0);
  const bp = new BackpressureController(run.targetTps);

  try {
    const planRaw = await redis.get(bombardPlanKey(runId));
    if (!planRaw) {
      await prisma.bombardRun.update({
        where: { id: runId },
        data: { status: 'FAILED', finishedAt: new Date() },
      });
      return { runId, status: 'FAILED', sentCount: sent, successCount: success, failCount: fail, note: 'no-plan' };
    }
    const plan = JSON.parse(planRaw) as RunnerPlan;

    const network = await loadNetworkBasic(run.networkId);
    if (!network) throw new Error(`network ${run.networkId} not found`);

    const relayer =
      plan.mode === 'RELAYER' ? buildRelayerClients(network) : null;
    const publicClient = relayer ? relayer.publicClient : buildPublicClientForNetwork(network);

    // Chain safety: the live chain must equal the configured one BEFORE any send.
    const liveChainId = await publicClient.getChainId();
    if (liveChainId !== plan.chainId) {
      await prisma.bombardRun.update({
        where: { id: runId },
        data: { status: 'FAILED', finishedAt: new Date() },
      });
      throw new Error(`chainId mismatch: live ${liveChainId} != plan ${plan.chainId}`);
    }

    const value = BigInt(plan.amountPerTxWei);
    const gas = BigInt(plan.gas);
    const maxFeePerGas = BigInt(plan.maxFeePerGasWei);
    const maxPriorityFeePerGas = BigInt(plan.maxPriorityFeePerGasWei);
    const txsKey = bombardTxsKey(runId);

    await flush('RUNNING');

    while (sent < total) {
      const now = Date.now();
      await refreshLock(now);

      // Control: cancel stops immediately; pause halts (resume re-enqueues).
      const control = await readControl(now);
      if (control === 'cancel') {
        await prisma.bombardRun.update({
          where: { id: runId },
          data: { status: 'CANCELLED', sentCount: sent, successCount: success, failCount: fail, finishedAt: new Date() },
        });
        await publish(redis, {
          runId, status: 'CANCELLED', sentCount: sent, successCount: success, failCount: fail,
          totalCount: total, targetTps: run.targetTps, effectiveTps: Math.round(bucket.ratePerSec),
          at: new Date().toISOString(),
        });
        return { runId, status: 'CANCELLED', sentCount: sent, successCount: success, failCount: fail, note: 'cancelled' };
      }
      if (control === 'pause') {
        await flush('PAUSED');
        await prisma.bombardRun.update({ where: { id: runId }, data: { status: 'PAUSED' } });
        return { runId, status: 'PAUSED', sentCount: sent, successCount: success, failCount: fail, note: 'paused' };
      }

      // Pace to the (possibly backpressured) effective rate.
      const consume = bucket.tryConsume(now);
      if (!consume.ok) {
        await sleep(consume.waitMs);
        continue;
      }

      const startedAt = Date.now();
      try {
        let txHash: string;
        if (plan.mode === 'CLIENT_SIGNED') {
          const raw = await redis.lindex(txsKey, sent);
          if (!raw) throw new Error(`missing pre-signed tx at index ${sent}`);
          txHash = await publicClient.sendRawTransaction({
            serializedTransaction: raw as `0x${string}`,
          });
        } else {
          if (!relayer) throw new Error('relayer clients unavailable');
          txHash = await relayer.walletClient.sendTransaction({
            account: relayer.account,
            to: plan.to as `0x${string}`,
            value,
            nonce: plan.startNonce + sent,
            gas,
            maxFeePerGas,
            maxPriorityFeePerGas,
          });
        }

        const latencyMs = Date.now() - startedAt;
        await prisma.bombardEvent.create({
          data: { runId, txHash, nonce: plan.startNonce + sent, status: 'BROADCAST', latencyMs },
        });
        sent += 1;
        success += 1;
        bp.onSuccess();
        bucket.setRate(bp.rate, Date.now());
      } catch (err) {
        if (isAlreadyOnChain(err)) {
          // This nonce is already mined (a resend after a crash/resume) — advance.
          sent += 1;
          success += 1;
          bp.onSuccess();
          bucket.setRate(bp.rate, Date.now());
        } else if (isBackpressureError(err)) {
          // REDUCE throughput + back off; retry the SAME tx (don't advance).
          const backoff = bp.onPushback();
          bucket.setRate(bp.rate, Date.now());
          await publish(redis, {
            runId, status: 'RUNNING', sentCount: sent, successCount: success, failCount: fail,
            totalCount: total, targetTps: run.targetTps, effectiveTps: Math.round(bp.rate),
            at: new Date().toISOString(),
          });
          await sleep(backoff);
        } else {
          // Hard failure (revert / malformed) — record + advance past it.
          await prisma.bombardEvent.create({
            data: { runId, nonce: plan.startNonce + sent, status: 'FAILED', latencyMs: Date.now() - startedAt },
          });
          sent += 1;
          fail += 1;
        }
      }

      if (Date.now() - lastFlush >= FLUSH_MS) await flush('RUNNING');
    }

    await flush('COMPLETED', true);
    await prisma.bombardRun.update({ where: { id: runId }, data: { status: 'COMPLETED' } });
    return { runId, status: 'COMPLETED', sentCount: sent, successCount: success, failCount: fail };
  } finally {
    // Release the per-user lock iff we still hold it.
    await redis
      .eval(
        `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
        1,
        lockKey,
        lockToken,
      )
      .catch(() => 0);
  }
}

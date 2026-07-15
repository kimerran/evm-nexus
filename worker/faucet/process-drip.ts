// faucet-drip processor — the ATOMIC authority for a native-token drip
// (SPEC §8.4/§9, AGENT.md §0/§5).
//
// Guarantees enforced here:
//   • Idempotent by requestId — only PENDING|QUEUED rows are processed; a retry
//     or duplicate job for an already in-flight/terminal row is a no-op.
//   • Atomic cooldown + daily-cap — a per-address Redis lock serializes the
//     re-check-against-DB and the broadcast, so two concurrent jobs can't both
//     pass the gate. The same pure policy the API used is re-evaluated here.
//   • Kill-switch — network.faucetEnabled AND the global `faucet.enabled`
//     AppSetting are re-read under the lock; either off → REJECTED, no spend.
//   • Chain safety — the live chainId is verified to equal the configured one
//     BEFORE any broadcast.
//   • Secrets — only tx HASHES / ids / addresses are logged; never the key or a
//     raw signed tx.
import {
  evaluateFaucetRequest,
  faucetProcessDecision,
} from '../../apps/web/lib/faucet/policy';
import { summarizeFaucetUsage } from '../../apps/web/lib/faucet/usage';
import {
  faucetLockKey,
  FAUCET_DAILY_WINDOW_SEC,
  FAUCET_ENABLED_SETTING,
} from '../../apps/web/lib/faucet/keys';
import { prisma } from '../lib/prisma';
import { acquireLock, releaseLock } from '../lib/redis';
import { buildFaucetClients, loadFaucetNetwork } from '../lib/chain';

/** Lock lifetime — generous for a local chain; the status guard is the real
 * double-processing defence if a broadcast ever outlives the lock. */
const LOCK_TTL_MS = 30_000;

export interface DripResult {
  requestId: string;
  status: string;
  txHash?: string;
  /** Reason the drip was skipped/rejected (for logs), if any. */
  note?: string;
}

async function isGloballyEnabled(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: FAUCET_ENABLED_SETTING } });
  return row ? row.value === true : true;
}

/** Process one faucet-drip job. Safe to call repeatedly for the same id. */
export async function processFaucetDrip(requestId: string): Promise<DripResult> {
  const row = await prisma.faucetRequest.findUnique({ where: { id: requestId } });
  if (!row) throw new Error(`FaucetRequest ${requestId} not found`);
  if (faucetProcessDecision(row.status) === 'skip') {
    return { requestId, status: row.status, note: 'already-processed' };
  }

  const lockKey = faucetLockKey(row.networkId, row.toAddress);
  const token = await acquireLock(lockKey, LOCK_TTL_MS);
  if (!token) {
    // Another drip to this address is in flight — let BullMQ retry with backoff.
    throw new Error(`faucet lock busy for ${row.toAddress}`);
  }

  try {
    // Re-read under the lock; a concurrent job may have advanced it.
    const fresh = await prisma.faucetRequest.findUnique({ where: { id: requestId } });
    if (!fresh || faucetProcessDecision(fresh.status) === 'skip') {
      return { requestId, status: fresh?.status ?? 'GONE', note: 'already-processed' };
    }

    const network = await loadFaucetNetwork(fresh.networkId);
    if (!network) throw new Error(`network ${fresh.networkId} not found`);

    // Usage EXCLUDING this row (it is QUEUED and must not count against itself).
    const now = Date.now();
    const windowSec = Math.max(network.cooldownSec, FAUCET_DAILY_WINDOW_SEC);
    const usageRows = await prisma.faucetRequest.findMany({
      where: {
        networkId: fresh.networkId,
        toAddress: fresh.toAddress,
        id: { not: requestId },
        createdAt: { gte: new Date(now - windowSec * 1000) },
      },
      select: { amount: true, createdAt: true, status: true },
    });
    const usage = summarizeFaucetUsage(usageRows, {
      now,
      cooldownSec: network.cooldownSec,
      dailyWindowSec: FAUCET_DAILY_WINDOW_SEC,
    });

    const requestedWei = BigInt(fresh.amount);
    const decision = evaluateFaucetRequest({
      enabled: network.faucetEnabled && (await isGloballyEnabled()),
      requestedWei,
      perRequestCapWei: network.dripWei,
      dailyCapWei: network.dailyCapWei,
      dailyUsedWei: usage.dailyUsedWei,
      cooldownActive: usage.cooldownActive,
    });
    if (!decision.ok) {
      await prisma.faucetRequest.update({ where: { id: requestId }, data: { status: 'REJECTED' } });
      return { requestId, status: 'REJECTED', note: decision.code };
    }

    // Chain safety: confirm the live chain matches the configured one.
    const { account, publicClient, walletClient } = buildFaucetClients(network);
    const liveChainId = await publicClient.getChainId();
    if (liveChainId !== network.chainId) {
      await prisma.faucetRequest.update({ where: { id: requestId }, data: { status: 'FAILED' } });
      throw new Error(`chainId mismatch: live ${liveChainId} != configured ${network.chainId}`);
    }

    await prisma.faucetRequest.update({ where: { id: requestId }, data: { status: 'BROADCAST' } });

    const hash = await walletClient.sendTransaction({
      account,
      to: fresh.toAddress as `0x${string}`,
      value: requestedWei,
    });
    await prisma.faucetRequest.update({
      where: { id: requestId },
      data: { status: 'CONFIRMING', txHash: hash },
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const ok = receipt.status === 'success';
    await prisma.faucetRequest.update({
      where: { id: requestId },
      data: { status: ok ? 'SUCCESS' : 'FAILED' },
    });

    return { requestId, status: ok ? 'SUCCESS' : 'FAILED', txHash: hash };
  } finally {
    await releaseLock(lockKey, token);
  }
}

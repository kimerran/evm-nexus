// deploy-watch processor — polls a deployment's receipt and finalizes the row
// (SPEC §8.5/§9, AGENT.md §5).
//
// Read-only on-chain: this watcher NEVER signs (no operator key here) — the tx was
// already broadcast from a client-signed payload. Guarantees:
//   • Idempotent by deploymentId — terminal rows (SUCCESS/FAILED/REJECTED) are a
//     no-op, so a retry/duplicate job can't double-finalize.
//   • Retry with backoff — if the receipt isn't ready within the per-attempt
//     window, it throws so BullMQ retries; on the FINAL attempt it marks FAILED
//     (timeout), never leaving a row stuck CONFIRMING forever.
//   • On a receipt it records contractAddress / gasUsed / blockNumber + SUCCESS or
//     FAILED (revert). Only ids / statuses / tx HASHES / addresses are logged.
import { getAddress } from 'viem';
import { prisma } from '../lib/prisma';
import { loadNetworkBasic, buildPublicClientForNetwork } from '../lib/chain';

/** Per-attempt wait for the receipt (BullMQ backoff spans several attempts). */
const RECEIPT_WAIT_MS = 20_000;
const POLL_INTERVAL_MS = 1_000;

const TERMINAL = new Set(['SUCCESS', 'FAILED', 'REJECTED']);

export interface WatchResult {
  deploymentId: string;
  status: string;
  contractAddress?: string | null;
  txHash?: string | null;
  note?: string;
}

/** Process one deploy-watch job. Safe to call repeatedly for the same id. */
export async function processDeployWatch(
  deploymentId: string,
  opts: { finalAttempt: boolean },
): Promise<WatchResult> {
  const row = await prisma.deployment.findUnique({ where: { id: deploymentId } });
  if (!row) throw new Error(`Deployment ${deploymentId} not found`);
  if (TERMINAL.has(row.status)) {
    return { deploymentId, status: row.status, note: 'already-finalized' };
  }
  if (!row.txHash) {
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'FAILED', errorMessage: 'No transaction hash to watch.' },
    });
    return { deploymentId, status: 'FAILED', note: 'no-tx-hash' };
  }

  const network = await loadNetworkBasic(row.networkId);
  if (!network) throw new Error(`network ${row.networkId} not found`);
  const publicClient = buildPublicClientForNetwork(network);

  // Mark CONFIRMING on the first look so the UI reflects in-flight state.
  if (row.status === 'PENDING' || row.status === 'BROADCAST') {
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'CONFIRMING' },
    });
  }

  const receipt = await publicClient
    .waitForTransactionReceipt({
      hash: row.txHash as `0x${string}`,
      timeout: RECEIPT_WAIT_MS,
      pollingInterval: POLL_INTERVAL_MS,
    })
    .catch(() => null);

  if (!receipt) {
    if (opts.finalAttempt) {
      await prisma.deployment.update({
        where: { id: deploymentId },
        data: { status: 'FAILED', errorMessage: 'Timed out waiting for transaction receipt.' },
      });
      return { deploymentId, status: 'FAILED', txHash: row.txHash, note: 'receipt-timeout' };
    }
    // Not mined yet — let BullMQ retry with backoff.
    throw new Error(`receipt not ready for ${row.txHash}`);
  }

  const success = receipt.status === 'success';
  const contractAddress = receipt.contractAddress ? getAddress(receipt.contractAddress) : null;
  await prisma.deployment.update({
    where: { id: deploymentId },
    data: {
      status: success ? 'SUCCESS' : 'FAILED',
      contractAddress,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: receipt.blockNumber,
      errorMessage: success ? null : 'Deployment transaction reverted.',
    },
  });

  return {
    deploymentId,
    status: success ? 'SUCCESS' : 'FAILED',
    contractAddress,
    txHash: row.txHash,
  };
}

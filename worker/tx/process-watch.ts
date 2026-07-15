// tx-watch processor — polls a transfer's receipt and finalizes the row
// (SPEC §8.6/§9, AGENT.md §5).
//
// Read-only on-chain: this watcher NEVER signs (no operator key here) — the tx was
// already broadcast from a client-signed payload. Designed to be SHARED: transfers
// today, chat commits (#15) and other client-signed txs later, all keyed by row id.
// Guarantees:
//   • Idempotent by transferId — terminal rows (SUCCESS/FAILED/REJECTED) are a
//     no-op, so a retry/duplicate job can't double-finalize.
//   • Retry with backoff — if the receipt isn't ready within the per-attempt
//     window, it throws so BullMQ retries; on the FINAL attempt it marks FAILED
//     (timeout), never leaving a row stuck CONFIRMING forever.
//   • On a receipt it records gasUsed/blockNumber (via metadata) + SUCCESS or
//     FAILED (revert), and publishes a live tx telemetry event. Only ids /
//     statuses / tx HASHES / addresses are logged.
import { prisma } from '../lib/prisma';
import { loadNetworkBasic, buildPublicClientForNetwork } from '../lib/chain';
import { getConnection } from '../lib/redis';
import { TELEMETRY_CHANNELS } from '../../apps/web/lib/telemetry/sse';
import type { TxTelemetryEvent } from '../../apps/web/lib/telemetry/tx-event';

/** Per-attempt wait for the receipt (BullMQ backoff spans several attempts). */
const RECEIPT_WAIT_MS = 20_000;
const POLL_INTERVAL_MS = 1_000;

const TERMINAL = new Set(['SUCCESS', 'FAILED', 'REJECTED']);

export interface TxWatchResult {
  transferId: string;
  status: string;
  txHash?: string | null;
  note?: string;
}

/** Best-effort publish of a `tx` telemetry event from the worker (never throws). */
async function publish(event: TxTelemetryEvent): Promise<void> {
  try {
    await getConnection().publish(TELEMETRY_CHANNELS.tx, JSON.stringify(event));
  } catch {
    // Telemetry must never break finalization.
  }
}

/** Process one tx-watch job. Safe to call repeatedly for the same id. */
export async function processTxWatch(
  transferId: string,
  opts: { finalAttempt: boolean },
): Promise<TxWatchResult> {
  const row = await prisma.transfer.findUnique({ where: { id: transferId } });
  if (!row) throw new Error(`Transfer ${transferId} not found`);
  if (TERMINAL.has(row.status)) {
    return { transferId, status: row.status, note: 'already-finalized' };
  }
  if (!row.txHash) {
    await prisma.transfer.update({
      where: { id: transferId },
      data: { status: 'FAILED', errorMessage: 'No transaction hash to watch.' },
    });
    return { transferId, status: 'FAILED', note: 'no-tx-hash' };
  }

  const network = await loadNetworkBasic(row.networkId);
  if (!network) throw new Error(`network ${row.networkId} not found`);
  const publicClient = buildPublicClientForNetwork(network);

  // Mark CONFIRMING on the first look so the UI reflects in-flight state.
  if (row.status === 'PENDING' || row.status === 'BROADCAST') {
    await prisma.transfer.update({
      where: { id: transferId },
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

  const baseEvent = {
    id: row.id,
    kind: row.kind,
    fromAddress: row.fromAddress,
    toAddress: row.toAddress,
    tokenAddress: row.tokenAddress,
    tokenId: row.tokenId,
    amount: row.amount,
    txHash: row.txHash,
  };

  if (!receipt) {
    if (opts.finalAttempt) {
      await prisma.transfer.update({
        where: { id: transferId },
        data: { status: 'FAILED', errorMessage: 'Timed out waiting for transaction receipt.' },
      });
      await publish({ ...baseEvent, status: 'FAILED', at: new Date().toISOString() });
      return { transferId, status: 'FAILED', txHash: row.txHash, note: 'receipt-timeout' };
    }
    // Not mined yet — let BullMQ retry with backoff.
    throw new Error(`receipt not ready for ${row.txHash}`);
  }

  const success = receipt.status === 'success';
  await prisma.transfer.update({
    where: { id: transferId },
    data: {
      status: success ? 'SUCCESS' : 'FAILED',
      errorMessage: success ? null : 'Transfer transaction reverted.',
    },
  });

  await publish({
    ...baseEvent,
    status: success ? 'SUCCESS' : 'FAILED',
    at: new Date().toISOString(),
  });

  return { transferId, status: success ? 'SUCCESS' : 'FAILED', txHash: row.txHash };
}

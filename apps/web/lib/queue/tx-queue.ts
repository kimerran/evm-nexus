// tx-watch producer — the web app's path to enqueue transfer receipt polling
// (SPEC §8.6/§9).
//
// SERVER-ONLY. The POST /api/transfers/broadcast handler calls `enqueueTxWatch`
// after it has broadcast the tx and created the Transfer row. No key material
// crosses here — only a Transfer id. The job id is the transfer id, so a
// duplicate enqueue is a Redis-level no-op (idempotency, defence-in-depth with
// the worker's status check). Shared with chat commits (#15) later.
import { Queue } from 'bullmq';
import { TX_WATCH_QUEUE, type TxWatchJobData } from '@/lib/transfers/keys';
import { getQueueConnection } from './connection';

const globalForTxQueue = globalThis as unknown as {
  nexusTxQueue?: Queue<TxWatchJobData>;
};

function txQueue(): Queue<TxWatchJobData> {
  globalForTxQueue.nexusTxQueue ??= new Queue<TxWatchJobData>(TX_WATCH_QUEUE, {
    connection: getQueueConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
  });
  return globalForTxQueue.nexusTxQueue;
}

/** Enqueue receipt polling for an already-broadcast Transfer. Idempotent by id. */
export async function enqueueTxWatch(transferId: string): Promise<void> {
  await txQueue().add(TX_WATCH_QUEUE, { transferId }, { jobId: transferId });
}

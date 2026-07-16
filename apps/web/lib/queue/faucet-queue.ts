// Faucet-drip producer — the web app's path to enqueue a drip (SPEC §8.4/§9).
//
// SERVER-ONLY. The POST /api/faucet/request handler calls `enqueueFaucetDrip`
// after it has created the FaucetRequest row. The signer key lives ONLY in the
// worker (AGENT.md §0) — this side merely hands off a request id. The job id is
// the request id, so a duplicate enqueue for the same request is a Redis-level
// no-op (idempotency, defence-in-depth with the worker's status check).
import { Queue } from 'bullmq';
import { FAUCET_DRIP_QUEUE, type FaucetDripJobData } from '@/lib/faucet/keys';
import { getQueueConnection } from './connection';

const globalForFaucetQueue = globalThis as unknown as {
  nexusFaucetQueue?: Queue<FaucetDripJobData>;
};

function faucetQueue(): Queue<FaucetDripJobData> {
  globalForFaucetQueue.nexusFaucetQueue ??= new Queue<FaucetDripJobData>(FAUCET_DRIP_QUEUE, {
    connection: getQueueConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
  });
  return globalForFaucetQueue.nexusFaucetQueue;
}

/** Enqueue a drip for an already-persisted FaucetRequest. Idempotent by id. */
export async function enqueueFaucetDrip(requestId: string): Promise<void> {
  await faucetQueue().add(FAUCET_DRIP_QUEUE, { requestId }, { jobId: requestId });
}

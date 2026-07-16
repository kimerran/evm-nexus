// bombard-runner producer — the web app's path to enqueue a run (SPEC §8.7/§9).
//
// SERVER-ONLY. The POST /api/bombard/start (and /resume) handler calls
// `enqueueBombardRun` after it has flipped the run to RUNNING and staged the raw
// signed txs + plan in Redis. No key material crosses here — only the run id.
// The job id is the run id, so a duplicate enqueue is a Redis-level no-op
// (idempotency, defence-in-depth with the worker's per-user lock + status check).
import { Queue } from 'bullmq';
import { BOMBARD_RUNNER_QUEUE, type BombardRunnerJobData } from '@/lib/bombard/keys';
import { getQueueConnection } from './connection';

const globalForBombardQueue = globalThis as unknown as {
  nexusBombardQueue?: Queue<BombardRunnerJobData>;
};

function bombardQueue(): Queue<BombardRunnerJobData> {
  globalForBombardQueue.nexusBombardQueue ??= new Queue<BombardRunnerJobData>(
    BOMBARD_RUNNER_QUEUE,
    {
      connection: getQueueConnection(),
      defaultJobOptions: {
        // The runner paces itself and resumes from the last nonce, so a small
        // retry count with backoff is enough to survive a transient lock/RPC blip.
        attempts: 3,
        backoff: { type: 'exponential', delay: 3_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    },
  );
  return globalForBombardQueue.nexusBombardQueue;
}

/**
 * Enqueue the runner for a run. `jobId` includes an attempt suffix so a resume
 * after a pause enqueues a fresh job rather than colliding with the (removed)
 * original job id.
 */
export async function enqueueBombardRun(runId: string, jobSuffix = 'run'): Promise<void> {
  // BullMQ forbids ':' in a custom job id, so segments join with '-'.
  await bombardQueue().add(
    BOMBARD_RUNNER_QUEUE,
    { runId },
    { jobId: `${runId}-${jobSuffix}` },
  );
}

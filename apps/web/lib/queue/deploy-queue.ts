// Deploy-watch producer — the web app's path to enqueue receipt polling (SPEC §8.5/§9).
//
// SERVER-ONLY. The POST /api/deployments/broadcast handler calls
// `enqueueDeployWatch` after it has broadcast the tx and created the Deployment
// row. No key material crosses here — only a Deployment id. The job id is the
// deployment id, so a duplicate enqueue is a Redis-level no-op (idempotency,
// defence-in-depth with the worker's status check).
import { Queue } from 'bullmq';
import { DEPLOY_WATCH_QUEUE, type DeployWatchJobData } from '@/lib/deployments/keys';
import { getQueueConnection } from './connection';

const globalForDeployQueue = globalThis as unknown as {
  nexusDeployQueue?: Queue<DeployWatchJobData>;
};

function deployQueue(): Queue<DeployWatchJobData> {
  globalForDeployQueue.nexusDeployQueue ??= new Queue<DeployWatchJobData>(DEPLOY_WATCH_QUEUE, {
    connection: getQueueConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
  });
  return globalForDeployQueue.nexusDeployQueue;
}

/** Enqueue receipt polling for an already-broadcast Deployment. Idempotent by id. */
export async function enqueueDeployWatch(deploymentId: string): Promise<void> {
  await deployQueue().add(DEPLOY_WATCH_QUEUE, { deploymentId }, { jobId: deploymentId });
}

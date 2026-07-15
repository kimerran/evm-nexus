// UserOp queue producers — the web app's path to the two worker-only operator
// keys (SPEC §8.9/§9, AGENT.md §5).
//
// SERVER-ONLY. No key material crosses here.
//   • `requestSponsor` enqueues a `userop-sponsor` job and AWAITS its result
//     (BullMQ `waitUntilFinished` via a shared QueueEvents). The paymaster signs
//     inside the worker; the web process only ever sees the returned signature
//     fields — the PAYMASTER_SIGNER key never enters this process.
//   • `enqueueUserOpBundle` hands a signed UserOp to the `userop-bundler` worker,
//     which submits `handleOps` with the RELAYER key. Job id = transferId, so a
//     duplicate enqueue is a Redis-level no-op (idempotency).
import { Queue, QueueEvents } from 'bullmq';
import {
  USEROP_SPONSOR_QUEUE,
  USEROP_BUNDLER_QUEUE,
  type UserOpSponsorJobData,
  type UserOpSponsorResult,
  type UserOpBundlerJobData,
} from '@/lib/smart-wallets/keys';
import { getQueueConnection } from './connection';

const globalForUserOpQueue = globalThis as unknown as {
  nexusUserOpSponsorQueue?: Queue<UserOpSponsorJobData, UserOpSponsorResult>;
  nexusUserOpSponsorEvents?: QueueEvents;
  nexusUserOpBundlerQueue?: Queue<UserOpBundlerJobData>;
};

function sponsorQueue(): Queue<UserOpSponsorJobData, UserOpSponsorResult> {
  globalForUserOpQueue.nexusUserOpSponsorQueue ??= new Queue<UserOpSponsorJobData, UserOpSponsorResult>(
    USEROP_SPONSOR_QUEUE,
    {
      connection: getQueueConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 500 },
        removeOnComplete: 500,
        removeOnFail: 1_000,
      },
    },
  );
  return globalForUserOpQueue.nexusUserOpSponsorQueue;
}

function sponsorEvents(): QueueEvents {
  globalForUserOpQueue.nexusUserOpSponsorEvents ??= new QueueEvents(USEROP_SPONSOR_QUEUE, {
    connection: getQueueConnection(),
  });
  return globalForUserOpQueue.nexusUserOpSponsorEvents;
}

function bundlerQueue(): Queue<UserOpBundlerJobData> {
  globalForUserOpQueue.nexusUserOpBundlerQueue ??= new Queue<UserOpBundlerJobData>(USEROP_BUNDLER_QUEUE, {
    connection: getQueueConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
  });
  return globalForUserOpQueue.nexusUserOpBundlerQueue;
}

/** Default wait for the worker to sign the paymaster data (ms). */
const SPONSOR_TIMEOUT_MS = 15_000;

/**
 * Ask the worker to sign the paymaster sponsorship over `data.userOp` and await
 * the result. Throws if the worker is unavailable or does not answer in time —
 * the caller maps that to a 503 so the client can retry.
 */
export async function requestSponsor(data: UserOpSponsorJobData): Promise<UserOpSponsorResult> {
  const events = sponsorEvents();
  await events.waitUntilReady();
  const job = await sponsorQueue().add(USEROP_SPONSOR_QUEUE, data);
  return (await job.waitUntilFinished(events, SPONSOR_TIMEOUT_MS)) as UserOpSponsorResult;
}

/** Enqueue bundling of an already-signed, sponsored UserOp. Idempotent by transferId. */
export async function enqueueUserOpBundle(data: UserOpBundlerJobData): Promise<void> {
  await bundlerQueue().add(USEROP_BUNDLER_QUEUE, data, { jobId: data.transferId });
}

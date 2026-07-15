// BullMQ worker entrypoint (SPEC §9, AGENT.md §0).
//
// This process is the ONLY place the operator faucet signer key is ever loaded
// (config.getFaucetPrivateKey). It registers the `faucet-drip` consumer and the
// read-only `deploy-watch` consumer; other consumers (bombard, bundler) are added
// in later sprints. Logs carry only ids / statuses / tx HASHES — never the key or
// a raw signed tx.
import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { getEnv } from './lib/config';
import { getConnection } from './lib/redis';
import { FAUCET_DRIP_QUEUE, type FaucetDripJobData } from '../apps/web/lib/faucet/keys';
import { DEPLOY_WATCH_QUEUE, type DeployWatchJobData } from '../apps/web/lib/deployments/keys';
import { TX_WATCH_QUEUE, type TxWatchJobData } from '../apps/web/lib/transfers/keys';
import { BOMBARD_RUNNER_QUEUE, type BombardRunnerJobData } from '../apps/web/lib/bombard/keys';
import { CHAT_COMMIT_QUEUE, type ChatCommitJobData } from '../apps/web/lib/chat/keys';
import { processFaucetDrip } from './faucet/process-drip';
import { processDeployWatch } from './deploy/process-watch';
import { processTxWatch, processChatCommitWatch } from './tx/process-watch';
import { processChatCommit } from './chat/process-commit';
import { processBombardRun } from './bombard/process-run';

function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

/** Whether this is the final BullMQ attempt for a job (so a watcher can finalize). */
function isFinalAttempt(job: Job): boolean {
  const max = job.opts.attempts ?? 1;
  return job.attemptsMade + 1 >= max;
}

function main(): void {
  const env = getEnv();
  log('worker.online', {
    queues: [
      FAUCET_DRIP_QUEUE,
      DEPLOY_WATCH_QUEUE,
      TX_WATCH_QUEUE,
      BOMBARD_RUNNER_QUEUE,
      CHAT_COMMIT_QUEUE,
    ],
    nodeEnv: env.NODE_ENV,
  });

  const faucetWorker = new Worker<FaucetDripJobData>(
    FAUCET_DRIP_QUEUE,
    async (job) => {
      const result = await processFaucetDrip(job.data.requestId);
      log('faucet.drip.processed', {
        requestId: result.requestId,
        status: result.status,
        txHash: result.txHash ?? null,
        note: result.note ?? null,
      });
      return result;
    },
    { connection: getConnection(), concurrency: 4 },
  );

  faucetWorker.on('failed', (job, err) => {
    log('faucet.drip.failed', { requestId: job?.data.requestId ?? null, error: err.message });
  });
  faucetWorker.on('error', (err) => {
    log('worker.error', { queue: FAUCET_DRIP_QUEUE, error: err.message });
  });

  const deployWorker = new Worker<DeployWatchJobData>(
    DEPLOY_WATCH_QUEUE,
    async (job) => {
      const result = await processDeployWatch(job.data.deploymentId, {
        finalAttempt: isFinalAttempt(job),
      });
      log('deploy.watch.processed', {
        deploymentId: result.deploymentId,
        status: result.status,
        contractAddress: result.contractAddress ?? null,
        txHash: result.txHash ?? null,
        note: result.note ?? null,
      });
      return result;
    },
    { connection: getConnection(), concurrency: 4 },
  );

  deployWorker.on('failed', (job, err) => {
    log('deploy.watch.failed', { deploymentId: job?.data.deploymentId ?? null, error: err.message });
  });
  deployWorker.on('error', (err) => {
    log('worker.error', { queue: DEPLOY_WATCH_QUEUE, error: err.message });
  });

  // tx-watch is SHARED: a job carries EITHER a transferId (transfers) OR a
  // chatMessageId (chat commits, #15); branch on which id is present.
  const txWorker = new Worker<TxWatchJobData>(
    TX_WATCH_QUEUE,
    async (job) => {
      if ('chatMessageId' in job.data) {
        const result = await processChatCommitWatch(job.data.chatMessageId, {
          finalAttempt: isFinalAttempt(job),
        });
        log('chat.watch.processed', {
          chatMessageId: result.chatMessageId,
          status: result.status,
          txHash: result.txHash ?? null,
          note: result.note ?? null,
        });
        return result;
      }
      const result = await processTxWatch(job.data.transferId, {
        finalAttempt: isFinalAttempt(job),
      });
      log('tx.watch.processed', {
        transferId: result.transferId,
        status: result.status,
        txHash: result.txHash ?? null,
        note: result.note ?? null,
      });
      return result;
    },
    { connection: getConnection(), concurrency: 4 },
  );

  txWorker.on('failed', (job, err) => {
    const id = job?.data
      ? 'chatMessageId' in job.data
        ? job.data.chatMessageId
        : job.data.transferId
      : null;
    log('tx.watch.failed', { id, error: err.message });
  });
  txWorker.on('error', (err) => {
    log('worker.error', { queue: TX_WATCH_QUEUE, error: err.message });
  });

  const chatCommitWorker = new Worker<ChatCommitJobData>(
    CHAT_COMMIT_QUEUE,
    async (job) => {
      const result = await processChatCommit(job.data.messageId);
      log('chat.commit.processed', {
        messageId: result.messageId,
        status: result.status,
        txHash: result.txHash ?? null,
        note: result.note ?? null,
      });
      return result;
    },
    { connection: getConnection(), concurrency: 2 },
  );

  chatCommitWorker.on('failed', (job, err) => {
    log('chat.commit.failed', { messageId: job?.data.messageId ?? null, error: err.message });
  });
  chatCommitWorker.on('error', (err) => {
    log('worker.error', { queue: CHAT_COMMIT_QUEUE, error: err.message });
  });

  // bombard-runner. Global concurrency lets DISTINCT users run in parallel; the
  // per-user Redis lock inside the processor enforces concurrency 1 PER USER.
  const bombardWorker = new Worker<BombardRunnerJobData>(
    BOMBARD_RUNNER_QUEUE,
    async (job) => {
      const result = await processBombardRun(job.data.runId);
      log('bombard.run.processed', {
        runId: result.runId,
        status: result.status,
        sentCount: result.sentCount,
        successCount: result.successCount,
        failCount: result.failCount,
        note: result.note ?? null,
      });
      return result;
    },
    { connection: getConnection(), concurrency: 4 },
  );

  bombardWorker.on('failed', (job, err) => {
    log('bombard.run.failed', { runId: job?.data.runId ?? null, error: err.message });
  });
  bombardWorker.on('error', (err) => {
    log('worker.error', { queue: BOMBARD_RUNNER_QUEUE, error: err.message });
  });

  const shutdown = (signal: string): void => {
    log('worker.shutdown', { signal });
    void Promise.all([
      faucetWorker.close(),
      deployWorker.close(),
      txWorker.close(),
      bombardWorker.close(),
      chatCommitWorker.close(),
    ]).then(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();

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
import { processFaucetDrip } from './faucet/process-drip';
import { processDeployWatch } from './deploy/process-watch';
import { processTxWatch } from './tx/process-watch';
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
    queues: [FAUCET_DRIP_QUEUE, DEPLOY_WATCH_QUEUE, TX_WATCH_QUEUE, BOMBARD_RUNNER_QUEUE],
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

  const txWorker = new Worker<TxWatchJobData>(
    TX_WATCH_QUEUE,
    async (job) => {
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
    log('tx.watch.failed', { transferId: job?.data.transferId ?? null, error: err.message });
  });
  txWorker.on('error', (err) => {
    log('worker.error', { queue: TX_WATCH_QUEUE, error: err.message });
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
    ]).then(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();

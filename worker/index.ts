// BullMQ worker entrypoint (SPEC §9, AGENT.md §0).
//
// This process is the ONLY place the operator faucet signer key is ever loaded
// (config.getFaucetPrivateKey). It registers the `faucet-drip` consumer; other
// consumers (bombard, watchers, bundler) are added in later sprints. Logs carry
// only ids / statuses / tx HASHES — never the key or a raw signed tx.
import { Worker } from 'bullmq';
import { getEnv } from './lib/config';
import { getConnection } from './lib/redis';
import { FAUCET_DRIP_QUEUE, type FaucetDripJobData } from '../apps/web/lib/faucet/keys';
import { processFaucetDrip } from './faucet/process-drip';

function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

function main(): void {
  const env = getEnv();
  log('worker.online', { queue: FAUCET_DRIP_QUEUE, nodeEnv: env.NODE_ENV });

  const worker = new Worker<FaucetDripJobData>(
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

  worker.on('failed', (job, err) => {
    log('faucet.drip.failed', { requestId: job?.data.requestId ?? null, error: err.message });
  });
  worker.on('error', (err) => {
    log('worker.error', { error: err.message });
  });

  const shutdown = (signal: string): void => {
    log('worker.shutdown', { signal });
    void worker.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();

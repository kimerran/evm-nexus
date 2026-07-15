// Shared BullMQ key + job types for the deploy-watch worker (SPEC §9, AGENT.md §2).
//
// PURE + dependency-free so the SAME queue/job names are used at both ends — the
// broadcast producer (apps/web) AND the deploy-watch consumer (worker) — and can
// never drift apart. No Redis/BullMQ client here.

/** BullMQ queue + job name for deployment receipt polling. */
export const DEPLOY_WATCH_QUEUE = 'deploy-watch';

/**
 * Payload for a `deploy-watch` job. Deliberately minimal — only the Deployment
 * row id. The worker re-reads every authoritative value (txHash, network) from
 * the row, so a stale/forged job body can never redirect a watch. The job id is
 * set to `deploymentId` for idempotency (BullMQ dedupes).
 */
export interface DeployWatchJobData {
  deploymentId: string;
}

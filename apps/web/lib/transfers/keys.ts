// Shared BullMQ key + telemetry types for the tx-watch worker (SPEC §9, AGENT.md §2).
//
// PURE + dependency-free so the SAME queue/job/channel names are used at BOTH
// ends — the broadcast producer (apps/web) AND the tx-watch consumer (worker) —
// and can never drift apart. No Redis/BullMQ client here. `tx-watch` is designed
// to be shared: transfers today, chat commits (#15) and other client-signed txs
// later, all reference the same row-id-only job.

/** BullMQ queue + job name for transfer/tx receipt polling. */
export const TX_WATCH_QUEUE = 'tx-watch';

/**
 * Payload for a `tx-watch` job. Deliberately minimal — a single row id. The
 * worker re-reads every authoritative value (txHash, network) from the row, so a
 * stale/forged job body can never redirect a watch. The job id is set to the row
 * id for idempotency (BullMQ dedupes). The queue is SHARED: a transfer watch
 * carries `transferId`; a chat-commit watch (#15) carries `chatMessageId`.
 */
export type TxWatchJobData = { transferId: string } | { chatMessageId: string };

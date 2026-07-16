// Shared BullMQ keys + job types for the chat-commit RELAYER worker (SPEC §9).
//
// PURE + dependency-free so the SAME queue/job names are used at BOTH ends — the
// producer (apps/web) and the consumer (worker). The relayer path is the budget-
// capped ALTERNATIVE to the client-signed commit: the operator key lives ONLY in
// the worker. Receipt-watching after a client-signed commit reuses the shared
// `tx-watch` queue (see lib/transfers/keys.ts) keyed by chatMessageId.

/** BullMQ queue + job name for operator-relayed chat commits. */
export const CHAT_COMMIT_QUEUE = 'chat-commit';

/**
 * Payload for a `chat-commit` job. Minimal — the ChatMessage row id only; the
 * worker re-reads every authoritative value from the row, so a stale/forged job
 * body can never redirect a commit. Job id = messageId for idempotency.
 */
export interface ChatCommitJobData {
  messageId: string;
}

/** AppSetting key for the relayer daily commit budget (count-based cap). */
export const CHAT_RELAYER_DAILY_CAP_SETTING = 'chat.relayerDailyCap';

/** Default relayer budget: max operator-funded commits per rolling day. */
export const DEFAULT_CHAT_RELAYER_DAILY_CAP = 200;

/** Redis key for the relayer's rolling daily commit counter. */
export function chatRelayerBudgetKey(): string {
  const day = new Date().toISOString().slice(0, 10);
  return `chat:relayer:budget:${day}`;
}

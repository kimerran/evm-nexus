// Shared BullMQ + Redis key constants for the bombard runner (SPEC §8.7/§9,
// AGENT.md §5). PURE + dependency-free so the SAME names are used at BOTH ends —
// the web producer (apps/web) AND the bombard-runner consumer (worker) — and can
// never drift apart. No Redis/BullMQ client here.

/** BullMQ queue + job name for the throughput stress runner. */
export const BOMBARD_RUNNER_QUEUE = 'bombard-runner';

/**
 * Payload for a `bombard-runner` job. Deliberately minimal — only the run id.
 * The worker re-reads every authoritative value (mode, counts, tps, addresses,
 * status) from the BombardRun row + the pinned plan, so a stale/forged job body
 * can never widen a run. The job id is set to `runId` for idempotency.
 */
export interface BombardRunnerJobData {
  runId: string;
}

/** AppSetting keys for the bombard ceilings, kill-switch, and relayer allow-list. */
export const BOMBARD_ENABLED_SETTING = 'bombard.enabled';
export const BOMBARD_MAX_TPS_SETTING = 'bombard.maxTps';
export const BOMBARD_MAX_TOTAL_SETTING = 'bombard.maxTotal';
export const BOMBARD_MAX_GAS_PER_TX_SETTING = 'bombard.maxGasPerTx';
export const BOMBARD_MAX_VALUE_PER_TX_WEI_SETTING = 'bombard.maxValuePerTxWei';
export const BOMBARD_MAX_FEE_PER_GAS_WEI_SETTING = 'bombard.maxFeePerGasWei';
export const BOMBARD_ALLOWLIST_SETTING = 'bombard.allowlist';

/**
 * Redis list holding the client-signed raw txs for a run, in nonce order. The
 * server receives ONLY raw signed txs (prime directive) and hands them to the
 * worker via this list; index `i` is the tx for `startNonce + i`.
 */
export function bombardTxsKey(runId: string): string {
  return `bombard:txs:${runId}`;
}

/**
 * Redis key holding the pinned execution plan (JSON) for a run — the trusted,
 * HMAC-verified parameters the worker needs (mode, chainId, addresses, per-tx
 * value/gas/fees, startNonce). Set by /start, read by the worker.
 */
export function bombardPlanKey(runId: string): string {
  return `bombard:plan:${runId}`;
}

/**
 * Redis key carrying a fast control signal for an in-flight run. Set by the
 * pause/cancel endpoints so a running worker reacts within a tick instead of
 * waiting on a DB poll. Values: `'pause' | 'cancel'`.
 */
export function bombardControlKey(runId: string): string {
  return `bombard:ctl:${runId}`;
}

/** Per-user lock enforcing concurrency 1 per user across bombard runners. */
export function bombardUserLockKey(userId: string): string {
  return `lock:bombard:user:${userId}`;
}

/** Fast control signals a pause/cancel endpoint can raise for a running worker. */
export type BombardControl = 'pause' | 'cancel';

/**
 * The trusted execution plan staged in Redis by /start for the worker to read.
 * Every field is derived from the HMAC-verified plan token, so the worker never
 * trusts a raw client value. Amounts stay decimal STRINGS (wei) — never floats.
 */
export interface RunnerPlan {
  mode: 'CLIENT_SIGNED' | 'RELAYER';
  chainId: number;
  from: string;
  to: string;
  amountPerTxWei: string;
  startNonce: number;
  totalCount: number;
  targetTps: number;
  gas: string;
  maxFeePerGasWei: string;
  maxPriorityFeePerGasWei: string;
}

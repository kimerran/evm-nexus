// Pure bombard policy: ceiling evaluation, run-status classification, and control
// transitions (SPEC §4.3/§8.7, AGENT.md §5). PURE + dependency-free (no prisma,
// no viem, no env) so the abuse-guard decisions are unit-tested directly and the
// SAME logic runs at the API boundary and, where relevant, in the worker.
import type { RunStatus } from '@/lib/generated/prisma/enums';

/** Resolved bombard ceilings + kill-switch + relayer allow-list (bigint/wei). */
export interface BombardCeilings {
  /** Global kill-switch — when false, no run may be prepared or started. */
  enabled: boolean;
  /** Hard cap on target TPS (min of env + AppSetting). */
  maxTps: number;
  /** Hard cap on total tx count for one run. */
  maxTotal: number;
  /** Max gas limit any single bombard tx may carry. */
  maxGasPerTx: bigint;
  /** Max native value any single bombard tx may move. */
  maxValuePerTxWei: bigint;
  /** Max maxFeePerGas / gasPrice any single bombard tx may carry. */
  maxFeePerGasWei: bigint;
  /** Lower-cased target-address allow-list for RELAYER mode (empty = none set). */
  allowlist: string[];
}

/** A validated bombard request as it enters ceiling evaluation. */
export interface BombardRequestShape {
  mode: 'CLIENT_SIGNED' | 'RELAYER';
  targetTps: number;
  totalCount: number;
  /** Per-tx native value in wei (decimal string). */
  amountPerTxWei: string;
  /** Target/recipient address (checksummed). */
  to: string;
}

/** Stable rejection codes so the API + tests assert on a symbol, not a message. */
export type BombardRejectionCode =
  | 'disabled'
  | 'tps-too-high'
  | 'tps-too-low'
  | 'total-too-high'
  | 'total-too-low'
  | 'value-too-high'
  | 'target-not-allowlisted';

export type BombardCeilingResult =
  | { ok: true }
  | { ok: false; code: BombardRejectionCode; message: string };

/**
 * Enforce every hard bombard ceiling against a request. Returns the FIRST breach
 * (or ok). This is the single authority the prepare route calls; a breach here
 * means the run is never created and nothing is ever broadcast.
 */
export function evaluateBombardCeilings(
  req: BombardRequestShape,
  ceilings: BombardCeilings,
): BombardCeilingResult {
  if (!ceilings.enabled) {
    return { ok: false, code: 'disabled', message: 'Bombard is currently disabled (kill-switch).' };
  }
  if (req.targetTps < 1) {
    return { ok: false, code: 'tps-too-low', message: 'targetTps must be at least 1.' };
  }
  if (req.targetTps > ceilings.maxTps) {
    return {
      ok: false,
      code: 'tps-too-high',
      message: `targetTps ${req.targetTps} exceeds the ceiling of ${ceilings.maxTps}.`,
    };
  }
  if (req.totalCount < 1) {
    return { ok: false, code: 'total-too-low', message: 'totalCount must be at least 1.' };
  }
  if (req.totalCount > ceilings.maxTotal) {
    return {
      ok: false,
      code: 'total-too-high',
      message: `totalCount ${req.totalCount} exceeds the ceiling of ${ceilings.maxTotal}.`,
    };
  }
  if (BigInt(req.amountPerTxWei) > ceilings.maxValuePerTxWei) {
    return {
      ok: false,
      code: 'value-too-high',
      message: `per-tx value ${req.amountPerTxWei} exceeds the ceiling of ${ceilings.maxValuePerTxWei}.`,
    };
  }
  // Relayer mode spends an OPERATOR key, so its target must be allow-listed when
  // an allow-list is configured (empty list = relayer mode disabled by default).
  if (req.mode === 'RELAYER') {
    if (ceilings.allowlist.length === 0 || !ceilings.allowlist.includes(req.to.toLowerCase())) {
      return {
        ok: false,
        code: 'target-not-allowlisted',
        message: 'Relayer-mode target address is not on the allow-list.',
      };
    }
  }
  return { ok: true };
}

/** Run statuses that count as "active" for the concurrency-1-per-user guard. */
export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ['QUEUED', 'RUNNING', 'PAUSED'];

/** Terminal run statuses — a run in one of these is finished and immutable. */
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

/** True when a run in this status still occupies the user's single active slot. */
export function isActiveRunStatus(status: RunStatus): boolean {
  return (ACTIVE_RUN_STATUSES as readonly string[]).includes(status);
}

/** True when a run in this status is finished (no further work possible). */
export function isTerminalRunStatus(status: RunStatus): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

/** A control action a user can apply to their run. */
export type BombardAction = 'pause' | 'resume' | 'cancel';

/**
 * Whether a control action is valid from the current status. Cancel is allowed
 * from any active status; pause only from RUNNING; resume only from PAUSED.
 */
export function canApplyAction(status: RunStatus, action: BombardAction): boolean {
  switch (action) {
    case 'cancel':
      return isActiveRunStatus(status);
    case 'pause':
      return status === 'RUNNING';
    case 'resume':
      return status === 'PAUSED';
  }
}

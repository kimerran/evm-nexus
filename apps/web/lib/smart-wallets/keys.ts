// Shared BullMQ keys + job/setting types for the ERC-4337 smart-wallet flow
// (SPEC §8.9/§9, AGENT.md §2/§5).
//
// PURE + dependency-free so the SAME queue/job/setting names are used at BOTH
// ends — the web producers (apps/web) and the worker consumers — and can never
// drift apart. No Redis/BullMQ client here.
//
// Two queues, two operator keys, both worker-only:
//   • `userop-sponsor` — the paymaster signs `paymasterAndData` with the
//     PAYMASTER_SIGNER key. The web `/sponsor` route enqueues a job and awaits
//     its return value (BullMQ waitUntilFinished), so the paymaster key never
//     enters the web process (prime directive, AGENT.md §5).
//   • `userop-bundler` — the relayer submits `handleOps` to the EntryPoint with
//     the RELAYER key, polls the receipt, and finalizes the Transfer row.
import type { SerializedUserOperation } from './userop';

/** BullMQ queue + job name for paymaster sponsorship signing (worker-only key). */
export const USEROP_SPONSOR_QUEUE = 'userop-sponsor';

/** BullMQ queue + job name for EntryPoint bundling (relayer-signed). */
export const USEROP_BUNDLER_QUEUE = 'userop-bundler';

/**
 * Payload for a `userop-sponsor` job. Carries the fully-scaffolded (but unsigned,
 * un-sponsored) UserOperation and the network it targets. The worker computes the
 * paymaster hash on-chain, signs it, and RETURNS the paymaster fields as the job
 * result — nothing is persisted, no key leaves the worker.
 */
export interface UserOpSponsorJobData {
  networkId: string;
  userOp: SerializedUserOperation;
}

/** The paymaster fields the sponsor worker returns for the client to merge + sign. */
export interface UserOpSponsorResult {
  paymaster: string;
  paymasterVerificationGasLimit: string;
  paymasterPostOpGasLimit: string;
  /** abi.encode(validUntil,validAfter) ++ paymaster-signer signature. */
  paymasterData: string;
  validUntil: number;
  validAfter: number;
}

/**
 * Payload for a `userop-bundler` job. Minimal — the Transfer row id plus the
 * signed UserOperation to submit. The UserOp is fully signed and public (no
 * secrets); the worker re-reads authoritative status from the row for idempotency.
 * Job id = transferId so a duplicate enqueue is a Redis-level no-op.
 */
export interface UserOpBundlerJobData {
  transferId: string;
  userOp: SerializedUserOperation;
}

// ---------- AppSetting keys ----------

/** Global kill-switch for sponsored UserOps. */
export const USEROP_SPONSOR_ENABLED_SETTING = 'userop.sponsorEnabled';
/** Max total gas cost (wei) a single sponsored UserOp may incur. */
export const USEROP_MAX_OP_COST_WEI_SETTING = 'userop.maxOpCostWei';
/** Rolling per-day paymaster spend ceiling (wei). */
export const USEROP_DAILY_CAP_WEI_SETTING = 'userop.dailyCapWei';

/** Per-network AppSetting key holding the deployed 4337 stack addresses. */
export function stackSettingKey(networkId: string): string {
  return `smartwallet.stack.${networkId}`;
}

/** Redis key for the paymaster's rolling daily spend counter (wei, as string). */
export function paymasterBudgetKey(networkId: string, day = new Date().toISOString().slice(0, 10)): string {
  return `userop:paymaster:budget:${networkId}:${day}`;
}

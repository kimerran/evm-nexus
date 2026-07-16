// Shared Redis key + window constants for the faucet (SPEC §8.4/§9, AGENT.md §5).
//
// PURE + dependency-free so the SAME names are used at both enforcement points —
// the POST /api/faucet/request boundary AND the drip worker — and can never
// drift apart. Amounts/keys only; no Redis client here.

/** BullMQ queue + job name for native-token faucet drips. */
export const FAUCET_DRIP_QUEUE = 'faucet-drip';

/**
 * Payload for a `faucet-drip` job. Deliberately minimal — only the FaucetRequest
 * id. The worker re-reads every authoritative value (amount, address, network,
 * status) from the row under a lock, so a stale/forged job body can never widen
 * a drip. The job id is set to `requestId` for idempotency (BullMQ dedupes).
 */
export interface FaucetDripJobData {
  requestId: string;
}

/** AppSetting key for the global faucet kill-switch (boolean). */
export const FAUCET_ENABLED_SETTING = 'faucet.enabled';

/**
 * Rolling window (seconds) used to sum an address's daily faucet usage.
 * Independent of the (typically longer) per-address cooldown.
 */
export const FAUCET_DAILY_WINDOW_SEC = 86_400;

/**
 * Redis lock key that serializes all drip processing for one destination
 * address on one network, so the cooldown + daily-cap check and the broadcast
 * happen atomically (no two concurrent jobs can both pass the gate).
 */
export function faucetLockKey(networkId: string, address: string): string {
  return `lock:faucet:${networkId}:${address.toLowerCase()}`;
}

// Faucet ceiling / cooldown / kill-switch decision logic (SPEC §8.4/§9, AGENT.md §5).
//
// PURE + dependency-free so it is exercised the SAME way at two enforcement
// points: the POST /api/faucet/request boundary (fast reject) AND the drip
// worker (the atomic authority, re-checked against the DB under a Redis lock).
// Keeping the decision here — not duplicated at each site — is what guarantees
// the two checks can never diverge. Amounts are bigint/wei throughout; nothing
// here touches JS floats (AGENT.md §4).

/** Why a faucet request was refused. Maps to a stable client-facing code. */
export type FaucetRejectCode =
  | 'KILL_SWITCH'
  | 'INVALID_AMOUNT'
  | 'CEILING'
  | 'COOLDOWN'
  | 'DAILY_CAP';

export type FaucetDecision =
  | { ok: true }
  | { ok: false; code: FaucetRejectCode; message: string };

export interface FaucetPolicyInput {
  /** Kill-switch: network.faucetEnabled AND the global `faucet.enabled` AppSetting. */
  enabled: boolean;
  /** Requested drip in wei. */
  requestedWei: bigint;
  /** Per-request ceiling in wei (the configured drip amount). */
  perRequestCapWei: bigint;
  /** Rolling daily cap in wei for this address/network. */
  dailyCapWei: bigint;
  /** Amount already dripped/committed in the current window (excludes this request). */
  dailyUsedWei: bigint;
  /** True when the address is still inside its cooldown window. */
  cooldownActive: boolean;
}

/**
 * Evaluate a faucet drip against every ceiling. Checks run in a fixed order so
 * the reason returned is deterministic and the most fundamental block (kill
 * switch) always wins. Returns `{ ok: true }` only when ALL gates pass.
 */
export function evaluateFaucetRequest(input: FaucetPolicyInput): FaucetDecision {
  if (!input.enabled) {
    return { ok: false, code: 'KILL_SWITCH', message: 'The faucet is currently disabled.' };
  }
  if (input.requestedWei <= 0n) {
    return { ok: false, code: 'INVALID_AMOUNT', message: 'Amount must be greater than zero.' };
  }
  if (input.requestedWei > input.perRequestCapWei) {
    return {
      ok: false,
      code: 'CEILING',
      message: `Amount exceeds the per-request cap of ${input.perRequestCapWei.toString()} wei.`,
    };
  }
  if (input.cooldownActive) {
    return {
      ok: false,
      code: 'COOLDOWN',
      message: 'This address is in a faucet cooldown. Try again later.',
    };
  }
  if (input.dailyUsedWei + input.requestedWei > input.dailyCapWei) {
    return {
      ok: false,
      code: 'DAILY_CAP',
      message: 'This address has reached its daily faucet cap.',
    };
  }
  return { ok: true };
}

/**
 * Idempotency gate for the drip worker. A job is keyed by `requestId`, but a
 * retry (or a duplicate enqueue) may re-run for a row that is already in-flight
 * or terminal — so the worker must only touch rows still awaiting a drip.
 */
export type FaucetProcessDecision = 'process' | 'skip';

/** Statuses from which the worker is allowed to start a drip. */
export function faucetProcessDecision(status: string): FaucetProcessDecision {
  return status === 'PENDING' || status === 'QUEUED' ? 'process' : 'skip';
}

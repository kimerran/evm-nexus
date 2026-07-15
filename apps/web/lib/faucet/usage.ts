// Faucet usage summarizer — cooldown + daily-cap accounting (SPEC §8.4/§9).
//
// PURE + dependency-free (no Prisma, no `@/` alias) so BOTH the API boundary and
// the drip worker feed it the same rows and get an identical verdict — the whole
// point of a single decision site (see policy.ts). Amounts are bigint/wei; the
// caller passes rows straight from FaucetRequest. A prior FAILED/REJECTED attempt
// never counts (it neither spent funds nor should it lock the address out).

/** The subset of a FaucetRequest row this module reasons about. */
export interface FaucetUsageRow {
  amount: string; // wei
  createdAt: Date;
  status: string; // TxStatus
}

/** Statuses that represent a drip that spent (or is about to spend) funds. */
const COUNTED_STATUSES = new Set(['PENDING', 'QUEUED', 'BROADCAST', 'CONFIRMING', 'SUCCESS']);

export interface FaucetUsage {
  /** Sum of wei dripped/committed inside the daily window. */
  dailyUsedWei: bigint;
  /** True when a counted request exists inside the cooldown window. */
  cooldownActive: boolean;
}

export interface FaucetUsageParams {
  now: number;
  cooldownSec: number;
  dailyWindowSec: number;
}

/**
 * Reduce an address's recent FaucetRequest rows into its current daily spend and
 * cooldown state. Rows outside every window (and non-counted statuses) are
 * ignored, so callers may over-fetch (e.g. "last 24h") without affecting the math.
 */
export function summarizeFaucetUsage(
  rows: readonly FaucetUsageRow[],
  { now, cooldownSec, dailyWindowSec }: FaucetUsageParams,
): FaucetUsage {
  const dailyCutoff = now - dailyWindowSec * 1000;
  const cooldownCutoff = now - cooldownSec * 1000;

  let dailyUsedWei = 0n;
  let cooldownActive = false;

  for (const row of rows) {
    if (!COUNTED_STATUSES.has(row.status)) continue;
    const at = row.createdAt.getTime();
    if (at > dailyCutoff) dailyUsedWei += BigInt(row.amount);
    if (at > cooldownCutoff) cooldownActive = true;
  }

  return { dailyUsedWei, cooldownActive };
}

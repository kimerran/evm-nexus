// Display formatters for telemetry values (BRAND §3.2). Pure and client-safe —
// no server imports. Wei values arrive as decimal strings and are reduced with
// bigint math only; we never `Number()` a wei amount (AGENT.md §4).

/** Em-dash placeholder for an absent/unparseable value. */
export const EM_DASH = '—';

/**
 * Format a wei amount (decimal string) as gwei with a fixed number of decimals,
 * using bigint math throughout so no precision is lost. Returns {@link EM_DASH}
 * for an unparseable input.
 *
 * @example formatWeiToGwei('1500000000') // '1.50'
 */
export function formatWeiToGwei(wei: string, decimals = 2): string {
  let value: bigint;
  try {
    value = BigInt(wei);
  } catch {
    return EM_DASH;
  }
  if (value < 0n) return EM_DASH;
  const gweiUnit = 1_000_000_000n;
  const whole = value / gweiUnit;
  if (decimals <= 0) return whole.toString();
  const scale = 10n ** BigInt(decimals);
  const frac = ((value % gweiUnit) * scale) / gweiUnit;
  return `${whole.toString()}.${frac.toString().padStart(decimals, '0')}`;
}

/** Format a nullable seconds value as `2.01` (or the em-dash placeholder). */
export function formatSeconds(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) return EM_DASH;
  return value.toFixed(decimals);
}

/** Format an integer with thousands separators, or the em-dash placeholder. */
export function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return EM_DASH;
  return Math.trunc(value).toLocaleString('en-US');
}

/** Format a block height (decimal string) as `#1,204,882`. */
export function formatBlockHeight(blockNumber: string): string {
  try {
    return `#${BigInt(blockNumber).toLocaleString('en-US')}`;
  } catch {
    return EM_DASH;
  }
}

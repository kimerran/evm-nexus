/**
 * Display formatting for machine data (BRAND §3.2). All hashes / addresses /
 * balances render in JetBrains Mono via the `code-*` type-scale utilities; these
 * helpers only shape the string, never the styling.
 */

/** Ellipsis character used for truncation (U+2026), not three dots. */
const ELLIPSIS = '…';

export interface TruncateOptions {
  /** Leading characters to keep, including any `0x` prefix. BRAND default: 5 (`0x71C`). */
  head?: number;
  /** Trailing characters to keep. BRAND default: 3 (`3A2`). */
  tail?: number;
}

/**
 * Truncate a long hex value to the BRAND `0x71C…3A2` form (§3.2): leading
 * head chars + ellipsis + trailing tail chars. Returns the input unchanged when
 * it is already short enough that truncation would not save space.
 *
 * @example truncateAddress('0x71C7656EC7ab88b098defB751B7401B5f6d8976F') // '0x71C…76F'
 */
export function truncateAddress(value: string, { head = 5, tail = 3 }: TruncateOptions = {}): string {
  if (head < 0 || tail < 0) {
    throw new Error('truncateAddress: head and tail must be non-negative');
  }
  // Not worth truncating unless we actually remove more than the ellipsis costs.
  if (value.length <= head + tail + ELLIPSIS.length) {
    return value;
  }
  return `${value.slice(0, head)}${ELLIPSIS}${value.slice(value.length - tail)}`;
}

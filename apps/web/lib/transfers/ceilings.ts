// Transfer chain-safety ceilings (AGENT.md §5, SPEC §11.1).
//
// SERVER-ONLY. Loads the gas / value / fee ceilings + global kill-switch from
// AppSetting, falling back to safe defaults when a key is absent (so the feature
// works before the seed runs). Amounts are bigint/wei in memory. These are the
// hard limits enforced BEFORE any broadcast — a signed tx exceeding any of them
// is rejected, never sent. Unlike deploys (non-payable), a native transfer moves
// value, so `maxValueWei` has a real, non-zero ceiling.
import { prisma } from '@/lib/db';

/** AppSetting keys for the transfer ceilings + kill-switch. */
export const TRANSFER_ENABLED_SETTING = 'transfer.enabled';
export const TRANSFER_MAX_GAS_SETTING = 'transfer.maxGas';
export const TRANSFER_MAX_VALUE_WEI_SETTING = 'transfer.maxValueWei';
export const TRANSFER_MAX_FEE_PER_GAS_WEI_SETTING = 'transfer.maxFeePerGasWei';

/** Resolved transfer ceilings (bigint/wei in memory). */
export interface TransferCeilings {
  enabled: boolean;
  /** Max `gasLimit` a transfer tx may carry. */
  maxGas: bigint;
  /** Max `value` a (native) transfer tx may move. */
  maxValueWei: bigint;
  /** Max `maxFeePerGas` / `gasPrice` a transfer tx may carry. */
  maxFeePerGasWei: bigint;
}

/** Safe defaults used when an AppSetting key is missing. */
export const DEFAULT_TRANSFER_CEILINGS: TransferCeilings = {
  enabled: true,
  maxGas: 500_000n, // generous for an ERC-1155 safeTransferFrom with receiver hook
  maxValueWei: 1_000_000_000_000_000_000_000n, // 1000 ETH — generous for a test chain
  maxFeePerGasWei: 1_000_000_000_000n, // 1000 gwei
};

function asBigint(value: unknown, fallback: bigint): bigint {
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return BigInt(value);
  return fallback;
}

/**
 * Load the effective transfer ceilings. Reads all `transfer.*` AppSetting rows in
 * one query; any missing key falls back to {@link DEFAULT_TRANSFER_CEILINGS}.
 * Only an explicit `false` disables (fails safe-on, like the faucet kill-switch).
 */
export async function loadTransferCeilings(): Promise<TransferCeilings> {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: {
        in: [
          TRANSFER_ENABLED_SETTING,
          TRANSFER_MAX_GAS_SETTING,
          TRANSFER_MAX_VALUE_WEI_SETTING,
          TRANSFER_MAX_FEE_PER_GAS_WEI_SETTING,
        ],
      },
    },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  const enabledRaw = byKey.get(TRANSFER_ENABLED_SETTING);
  return {
    enabled: enabledRaw === undefined ? DEFAULT_TRANSFER_CEILINGS.enabled : enabledRaw === true,
    maxGas: asBigint(byKey.get(TRANSFER_MAX_GAS_SETTING), DEFAULT_TRANSFER_CEILINGS.maxGas),
    maxValueWei: asBigint(
      byKey.get(TRANSFER_MAX_VALUE_WEI_SETTING),
      DEFAULT_TRANSFER_CEILINGS.maxValueWei,
    ),
    maxFeePerGasWei: asBigint(
      byKey.get(TRANSFER_MAX_FEE_PER_GAS_WEI_SETTING),
      DEFAULT_TRANSFER_CEILINGS.maxFeePerGasWei,
    ),
  };
}

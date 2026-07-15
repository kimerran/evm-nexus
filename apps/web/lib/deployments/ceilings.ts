// Deploy chain-safety ceilings (AGENT.md §5, SPEC §11.1).
//
// SERVER-ONLY. Loads the gas / value / fee ceilings + global kill-switch from
// AppSetting, falling back to safe defaults when a key is absent (so the feature
// works before the seed runs). Amounts are bigint/wei in memory. These are the
// hard limits enforced BEFORE any broadcast — a signed tx exceeding any of them
// is rejected, never sent.
import { prisma } from '@/lib/db';

/** AppSetting keys for the deploy ceilings + kill-switch. */
export const DEPLOY_ENABLED_SETTING = 'deploy.enabled';
export const DEPLOY_MAX_GAS_SETTING = 'deploy.maxGas';
export const DEPLOY_MAX_VALUE_WEI_SETTING = 'deploy.maxValueWei';
export const DEPLOY_MAX_FEE_PER_GAS_WEI_SETTING = 'deploy.maxFeePerGasWei';

/** Resolved deploy ceilings (bigint/wei in memory). */
export interface DeployCeilings {
  enabled: boolean;
  /** Max `gasLimit` a deploy tx may carry. */
  maxGas: bigint;
  /** Max `value` (a token deploy is non-payable → default 0). */
  maxValueWei: bigint;
  /** Max `maxFeePerGas` / `gasPrice` a deploy tx may carry. */
  maxFeePerGasWei: bigint;
}

/** Safe defaults used when an AppSetting key is missing. */
export const DEFAULT_DEPLOY_CEILINGS: DeployCeilings = {
  enabled: true,
  maxGas: 15_000_000n,
  maxValueWei: 0n,
  maxFeePerGasWei: 1_000_000_000_000n, // 1000 gwei — generous for test chains
};

function asBigint(value: unknown, fallback: bigint): bigint {
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return BigInt(value);
  return fallback;
}

/**
 * Load the effective deploy ceilings. Reads all `deploy.*` AppSetting rows in one
 * query; any missing key falls back to {@link DEFAULT_DEPLOY_CEILINGS}. Only an
 * explicit `false` disables (fails safe-on, like the faucet kill-switch).
 */
export async function loadDeployCeilings(): Promise<DeployCeilings> {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: {
        in: [
          DEPLOY_ENABLED_SETTING,
          DEPLOY_MAX_GAS_SETTING,
          DEPLOY_MAX_VALUE_WEI_SETTING,
          DEPLOY_MAX_FEE_PER_GAS_WEI_SETTING,
        ],
      },
    },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  const enabledRaw = byKey.get(DEPLOY_ENABLED_SETTING);
  return {
    enabled: enabledRaw === undefined ? DEFAULT_DEPLOY_CEILINGS.enabled : enabledRaw === true,
    maxGas: asBigint(byKey.get(DEPLOY_MAX_GAS_SETTING), DEFAULT_DEPLOY_CEILINGS.maxGas),
    maxValueWei: asBigint(
      byKey.get(DEPLOY_MAX_VALUE_WEI_SETTING),
      DEFAULT_DEPLOY_CEILINGS.maxValueWei,
    ),
    maxFeePerGasWei: asBigint(
      byKey.get(DEPLOY_MAX_FEE_PER_GAS_WEI_SETTING),
      DEFAULT_DEPLOY_CEILINGS.maxFeePerGasWei,
    ),
  };
}

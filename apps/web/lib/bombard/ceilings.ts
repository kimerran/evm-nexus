// Bombard ceiling loader (SPEC §4.3/§8.7/§11.1, AGENT.md §5). SERVER-ONLY.
//
// Resolves the effective ceilings from the ENV hard caps (BOMBARD_MAX_TPS /
// BOMBARD_MAX_TOTAL — the absolute ceilings that AppSetting can only tighten, not
// widen) combined with the AppSetting overrides + kill-switch + relayer allow-
// list. Amounts are bigint/wei in memory. Missing keys fall back to safe defaults
// so the feature works before the seed runs.
import { getEnv } from '@nexus/config/env';
import { prisma } from '@/lib/db';
import {
  BOMBARD_ENABLED_SETTING,
  BOMBARD_MAX_TPS_SETTING,
  BOMBARD_MAX_TOTAL_SETTING,
  BOMBARD_MAX_GAS_PER_TX_SETTING,
  BOMBARD_MAX_VALUE_PER_TX_WEI_SETTING,
  BOMBARD_MAX_FEE_PER_GAS_WEI_SETTING,
  BOMBARD_ALLOWLIST_SETTING,
} from './keys';
import type { BombardCeilings } from './policy';

/** Safe defaults for the per-tx ceilings when an AppSetting key is absent. */
export const DEFAULT_BOMBARD_CEILINGS = {
  maxGasPerTx: 100_000n, // a native transfer is 21000; generous headroom
  maxValuePerTxWei: 1_000_000_000_000_000_000n, // 1 ETH per tx
  maxFeePerGasWei: 1_000_000_000_000n, // 1000 gwei
} as const;

function asBigint(value: unknown, fallback: bigint): bigint {
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return BigInt(value);
  return fallback;
}

function asPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
    const n = Number(value);
    if (Number.isSafeInteger(n) && n > 0) return n;
  }
  return fallback;
}

function asAllowlist(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);
}

/**
 * Load the effective bombard ceilings. ENV provides the ABSOLUTE tps/total caps;
 * an AppSetting override may only make them stricter (`Math.min`), never widen
 * them — so a tampered/misconfigured setting can't exceed the deployment's hard
 * limit. Only an explicit `false` disables (fails safe-on, like the faucet).
 */
export async function loadBombardCeilings(): Promise<BombardCeilings> {
  const env = getEnv();
  const rows = await prisma.appSetting.findMany({
    where: {
      key: {
        in: [
          BOMBARD_ENABLED_SETTING,
          BOMBARD_MAX_TPS_SETTING,
          BOMBARD_MAX_TOTAL_SETTING,
          BOMBARD_MAX_GAS_PER_TX_SETTING,
          BOMBARD_MAX_VALUE_PER_TX_WEI_SETTING,
          BOMBARD_MAX_FEE_PER_GAS_WEI_SETTING,
          BOMBARD_ALLOWLIST_SETTING,
        ],
      },
    },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  const enabledRaw = byKey.get(BOMBARD_ENABLED_SETTING);
  const settingTps = asPositiveInt(byKey.get(BOMBARD_MAX_TPS_SETTING), env.BOMBARD_MAX_TPS);
  const settingTotal = asPositiveInt(byKey.get(BOMBARD_MAX_TOTAL_SETTING), env.BOMBARD_MAX_TOTAL);

  return {
    enabled: enabledRaw === undefined ? true : enabledRaw === true,
    // AppSetting can only TIGHTEN the env hard cap, never exceed it.
    maxTps: Math.min(env.BOMBARD_MAX_TPS, settingTps),
    maxTotal: Math.min(env.BOMBARD_MAX_TOTAL, settingTotal),
    maxGasPerTx: asBigint(
      byKey.get(BOMBARD_MAX_GAS_PER_TX_SETTING),
      DEFAULT_BOMBARD_CEILINGS.maxGasPerTx,
    ),
    maxValuePerTxWei: asBigint(
      byKey.get(BOMBARD_MAX_VALUE_PER_TX_WEI_SETTING),
      DEFAULT_BOMBARD_CEILINGS.maxValuePerTxWei,
    ),
    maxFeePerGasWei: asBigint(
      byKey.get(BOMBARD_MAX_FEE_PER_GAS_WEI_SETTING),
      DEFAULT_BOMBARD_CEILINGS.maxFeePerGasWei,
    ),
    allowlist: asAllowlist(byKey.get(BOMBARD_ALLOWLIST_SETTING)),
  };
}

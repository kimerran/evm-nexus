// Paymaster budget cap for sponsored UserOps (SPEC §8.9, AGENT.md §5).
//
// SERVER-ONLY. Sponsoring gas spends real operator funds, so every sponsor
// request is bounded two ways, loaded from AppSetting (safe defaults when a key
// is absent so the feature works before the seed runs):
//   • `maxOpCostWei` — a single UserOp's worst-case gas cost may not exceed this.
//   • `dailyCapWei`  — a rolling per-day, per-network paymaster spend ceiling,
//     tracked in Redis; a request that would push the day's total past the cap is
//     rejected BEFORE the paymaster signs.
// The pure {@link evaluateBudget} decision is unit-tested without Redis; the
// Redis reservation (`reservePaymasterBudget`) is the live enforcement path and
// FAILS CLOSED — a Redis error rejects the sponsor rather than spending blind.
import { prisma } from '@/lib/db';
import { getRedis } from '@/lib/redis';
import {
  USEROP_SPONSOR_ENABLED_SETTING,
  USEROP_MAX_OP_COST_WEI_SETTING,
  USEROP_DAILY_CAP_WEI_SETTING,
  paymasterBudgetKey,
} from './keys';

/** Resolved budget caps (bigint/wei in memory). */
export interface BudgetCaps {
  enabled: boolean;
  maxOpCostWei: bigint;
  dailyCapWei: bigint;
}

/** Safe defaults used when an AppSetting key is missing. */
export const DEFAULT_BUDGET_CAPS: BudgetCaps = {
  enabled: true,
  maxOpCostWei: 100_000_000_000_000_000n, // 0.1 ETH
  dailyCapWei: 5_000_000_000_000_000_000n, // 5 ETH / day
};

function asBigint(value: unknown, fallback: bigint): bigint {
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return BigInt(value);
  return fallback;
}

/** Load the effective paymaster budget caps from AppSetting. */
export async function loadBudgetCaps(): Promise<BudgetCaps> {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: {
        in: [
          USEROP_SPONSOR_ENABLED_SETTING,
          USEROP_MAX_OP_COST_WEI_SETTING,
          USEROP_DAILY_CAP_WEI_SETTING,
        ],
      },
    },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const enabledRaw = byKey.get(USEROP_SPONSOR_ENABLED_SETTING);
  return {
    enabled: enabledRaw === undefined ? DEFAULT_BUDGET_CAPS.enabled : enabledRaw === true,
    maxOpCostWei: asBigint(byKey.get(USEROP_MAX_OP_COST_WEI_SETTING), DEFAULT_BUDGET_CAPS.maxOpCostWei),
    dailyCapWei: asBigint(byKey.get(USEROP_DAILY_CAP_WEI_SETTING), DEFAULT_BUDGET_CAPS.dailyCapWei),
  };
}

/** Reason a sponsor request was rejected by the budget cap. */
export type BudgetRejection = 'disabled' | 'per-op-cap' | 'daily-cap';

export type BudgetDecision =
  | { allowed: true }
  | { allowed: false; reason: BudgetRejection; message: string };

/**
 * Pure budget decision. Rejects when sponsorship is disabled, the single op's
 * cost exceeds the per-op cap, or adding it would exceed the day's remaining
 * budget. Deterministic — no I/O — so it is fully unit-testable.
 */
export function evaluateBudget(input: {
  caps: BudgetCaps;
  opCostWei: bigint;
  spentTodayWei: bigint;
}): BudgetDecision {
  const { caps, opCostWei, spentTodayWei } = input;
  if (!caps.enabled) {
    return { allowed: false, reason: 'disabled', message: 'Sponsored transactions are currently disabled.' };
  }
  if (opCostWei > caps.maxOpCostWei) {
    return {
      allowed: false,
      reason: 'per-op-cap',
      message: `UserOp gas cost ${opCostWei} exceeds the per-op paymaster cap ${caps.maxOpCostWei}.`,
    };
  }
  if (spentTodayWei + opCostWei > caps.dailyCapWei) {
    return {
      allowed: false,
      reason: 'daily-cap',
      message: 'The paymaster daily sponsorship budget has been exhausted. Try again tomorrow.',
    };
  }
  return { allowed: true };
}

/** 1 gwei in wei — the counter granularity that keeps Redis INCRBY within JS ints. */
const WEI_PER_GWEI = 1_000_000_000n;

/** Round a wei amount UP to whole gwei (never under-charge the budget). */
function toGweiCeil(wei: bigint): number {
  return Number((wei + WEI_PER_GWEI - 1n) / WEI_PER_GWEI);
}

/**
 * Atomically check the caps AND reserve `opCostWei` against the day's rolling
 * budget in Redis. Returns the decision; on `allowed`, the spend is already
 * recorded (so concurrent requests can't both slip under the cap). The counter is
 * kept in whole-gwei units so an atomic INCRBY never overflows a JS integer while
 * staying precise enough for a spend cap. FAILS CLOSED on any Redis error — an
 * unavailable budget store must not let the paymaster spend blind.
 */
export async function reservePaymasterBudget(input: {
  networkId: string;
  caps: BudgetCaps;
  opCostWei: bigint;
  now?: Date;
}): Promise<BudgetDecision> {
  const { networkId, caps, opCostWei } = input;
  if (!caps.enabled) {
    return { allowed: false, reason: 'disabled', message: 'Sponsored transactions are currently disabled.' };
  }
  if (opCostWei > caps.maxOpCostWei) {
    return {
      allowed: false,
      reason: 'per-op-cap',
      message: `UserOp gas cost ${opCostWei} exceeds the per-op paymaster cap ${caps.maxOpCostWei}.`,
    };
  }
  const day = (input.now ?? new Date()).toISOString().slice(0, 10);
  const key = paymasterBudgetKey(networkId, day);
  const opGwei = toGweiCeil(opCostWei);
  const capGwei = toGweiCeil(caps.dailyCapWei);
  try {
    const redis = getRedis();
    // Reserve first (atomic INCRBY), then bounds-check; roll back on overflow.
    const totalGwei = await redis.incrby(key, opGwei);
    await redis.expire(key, 2 * 24 * 60 * 60); // stale day-keys self-expire
    if (totalGwei > capGwei) {
      await redis.decrby(key, opGwei);
      return {
        allowed: false,
        reason: 'daily-cap',
        message: 'The paymaster daily sponsorship budget has been exhausted. Try again tomorrow.',
      };
    }
    return { allowed: true };
  } catch {
    return {
      allowed: false,
      reason: 'daily-cap',
      message: 'Budget store unavailable — sponsorship temporarily rejected.',
    };
  }
}

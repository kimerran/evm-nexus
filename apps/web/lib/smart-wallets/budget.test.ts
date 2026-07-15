// Unit tests for the paymaster budget cap decision (SPEC §8.9, AGENT.md §5).
//
// The pure `evaluateBudget` decision is exercised without Redis/DB — the same
// logic the live `reservePaymasterBudget` enforces atomically.
import { describe, it, expect } from 'vitest';
import { evaluateBudget, DEFAULT_BUDGET_CAPS, type BudgetCaps } from './budget';

const caps: BudgetCaps = {
  enabled: true,
  maxOpCostWei: 100_000_000_000_000_000n, // 0.1 ETH
  dailyCapWei: 1_000_000_000_000_000_000n, // 1 ETH
};

describe('evaluateBudget', () => {
  it('allows an op within both caps', () => {
    const d = evaluateBudget({ caps, opCostWei: 1_000_000_000_000_000n, spentTodayWei: 0n });
    expect(d.allowed).toBe(true);
  });

  it('rejects when sponsorship is disabled', () => {
    const d = evaluateBudget({ caps: { ...caps, enabled: false }, opCostWei: 1n, spentTodayWei: 0n });
    expect(d).toMatchObject({ allowed: false, reason: 'disabled' });
  });

  it('rejects an op exceeding the per-op cap', () => {
    const d = evaluateBudget({ caps, opCostWei: caps.maxOpCostWei + 1n, spentTodayWei: 0n });
    expect(d).toMatchObject({ allowed: false, reason: 'per-op-cap' });
  });

  it('allows an op exactly at the per-op cap', () => {
    const d = evaluateBudget({ caps, opCostWei: caps.maxOpCostWei, spentTodayWei: 0n });
    expect(d.allowed).toBe(true);
  });

  it('rejects when the op would push the daily total past the cap', () => {
    const d = evaluateBudget({
      caps,
      opCostWei: caps.maxOpCostWei,
      spentTodayWei: caps.dailyCapWei, // already at the ceiling
    });
    expect(d).toMatchObject({ allowed: false, reason: 'daily-cap' });
  });

  it('allows the op that brings the daily total exactly to the cap', () => {
    const d = evaluateBudget({
      caps,
      opCostWei: caps.maxOpCostWei,
      spentTodayWei: caps.dailyCapWei - caps.maxOpCostWei,
    });
    expect(d.allowed).toBe(true);
  });

  it('ships safe non-zero defaults', () => {
    expect(DEFAULT_BUDGET_CAPS.enabled).toBe(true);
    expect(DEFAULT_BUDGET_CAPS.maxOpCostWei).toBeGreaterThan(0n);
    expect(DEFAULT_BUDGET_CAPS.dailyCapWei).toBeGreaterThan(DEFAULT_BUDGET_CAPS.maxOpCostWei);
  });
});

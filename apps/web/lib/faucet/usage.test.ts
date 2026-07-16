import { describe, expect, it } from 'vitest';
import { summarizeFaucetUsage, type FaucetUsageRow } from './usage';

const NOW = 1_700_000_000_000;
const HOUR = 3_600 * 1000;

function row(overrides: Partial<FaucetUsageRow> = {}): FaucetUsageRow {
  return {
    amount: '1000000000000000000', // 1 ETH
    createdAt: new Date(NOW - HOUR),
    status: 'SUCCESS',
    ...overrides,
  };
}

const params = { now: NOW, cooldownSec: 86_400, dailyWindowSec: 86_400 };

describe('summarizeFaucetUsage', () => {
  it('sums counted drips inside the daily window', () => {
    const usage = summarizeFaucetUsage([row(), row({ amount: '500' })], params);
    expect(usage.dailyUsedWei).toBe(1_000_000_000_000_000_000n + 500n);
  });

  it('excludes FAILED and REJECTED attempts from spend and cooldown', () => {
    const usage = summarizeFaucetUsage(
      [row({ status: 'FAILED' }), row({ status: 'REJECTED' })],
      params,
    );
    expect(usage.dailyUsedWei).toBe(0n);
    expect(usage.cooldownActive).toBe(false);
  });

  it('counts an in-flight (QUEUED/BROADCAST) drip toward cooldown', () => {
    expect(summarizeFaucetUsage([row({ status: 'QUEUED' })], params).cooldownActive).toBe(true);
    expect(summarizeFaucetUsage([row({ status: 'BROADCAST' })], params).cooldownActive).toBe(true);
  });

  it('drops rows older than the windows', () => {
    const old = row({ createdAt: new Date(NOW - 2 * 86_400 * 1000) });
    const usage = summarizeFaucetUsage([old], params);
    expect(usage.dailyUsedWei).toBe(0n);
    expect(usage.cooldownActive).toBe(false);
  });

  it('separates a short cooldown from the daily window', () => {
    // A drip 2h ago: still inside a 24h daily window, but past a 1h cooldown.
    const usage = summarizeFaucetUsage([row({ createdAt: new Date(NOW - 2 * HOUR) })], {
      now: NOW,
      cooldownSec: 3_600,
      dailyWindowSec: 86_400,
    });
    expect(usage.dailyUsedWei).toBe(1_000_000_000_000_000_000n);
    expect(usage.cooldownActive).toBe(false);
  });
});

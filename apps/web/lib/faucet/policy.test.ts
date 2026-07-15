import { describe, expect, it } from 'vitest';
import {
  evaluateFaucetRequest,
  faucetProcessDecision,
  type FaucetPolicyInput,
} from './policy';

// A baseline input that PASSES every gate; each test perturbs one field so the
// assertion isolates a single ceiling.
function baseInput(overrides: Partial<FaucetPolicyInput> = {}): FaucetPolicyInput {
  return {
    enabled: true,
    requestedWei: 1_000n,
    perRequestCapWei: 5_000n,
    dailyCapWei: 10_000n,
    dailyUsedWei: 0n,
    cooldownActive: false,
    ...overrides,
  };
}

describe('evaluateFaucetRequest', () => {
  it('accepts a request within every ceiling', () => {
    expect(evaluateFaucetRequest(baseInput())).toEqual({ ok: true });
  });

  it('blocks when the kill-switch is off (and it wins over other failures)', () => {
    const decision = evaluateFaucetRequest(
      baseInput({ enabled: false, requestedWei: 9_999n, cooldownActive: true }),
    );
    expect(decision).toEqual({ ok: false, code: 'KILL_SWITCH', message: expect.any(String) });
  });

  it('rejects a non-positive amount', () => {
    expect(evaluateFaucetRequest(baseInput({ requestedWei: 0n }))).toMatchObject({
      ok: false,
      code: 'INVALID_AMOUNT',
    });
  });

  it('rejects an amount over the per-request ceiling', () => {
    expect(evaluateFaucetRequest(baseInput({ requestedWei: 5_001n }))).toMatchObject({
      ok: false,
      code: 'CEILING',
    });
  });

  it('accepts an amount exactly at the ceiling', () => {
    expect(evaluateFaucetRequest(baseInput({ requestedWei: 5_000n }))).toEqual({ ok: true });
  });

  it('blocks while the address is in cooldown', () => {
    expect(evaluateFaucetRequest(baseInput({ cooldownActive: true }))).toMatchObject({
      ok: false,
      code: 'COOLDOWN',
    });
  });

  it('blocks when this request would exceed the daily cap', () => {
    // used + requested = 9_500 + 1_000 > 10_000
    expect(
      evaluateFaucetRequest(baseInput({ dailyUsedWei: 9_500n, requestedWei: 1_000n })),
    ).toMatchObject({ ok: false, code: 'DAILY_CAP' });
  });

  it('accepts a request that lands exactly on the daily cap', () => {
    expect(
      evaluateFaucetRequest(baseInput({ dailyUsedWei: 9_000n, requestedWei: 1_000n })),
    ).toEqual({ ok: true });
  });
});

describe('faucetProcessDecision (idempotency by requestId)', () => {
  it('processes only PENDING or QUEUED rows', () => {
    expect(faucetProcessDecision('PENDING')).toBe('process');
    expect(faucetProcessDecision('QUEUED')).toBe('process');
  });

  it('skips any in-flight or terminal row (a duplicate/retry is a no-op)', () => {
    for (const status of ['BROADCAST', 'CONFIRMING', 'SUCCESS', 'FAILED', 'REJECTED']) {
      expect(faucetProcessDecision(status)).toBe('skip');
    }
  });
});

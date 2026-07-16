// Unit tests for the signed bombard PLAN token (SPEC §8.7, AGENT.md §5/§8).
//
// The plan pins the assigned nonce range (`startNonce` + `totalCount`) and every
// execution parameter, then HMAC-signs it so `/start` can trust the pinned plan
// rather than anything the client could forge. These tests exercise the token
// round-trip, tamper detection, and expiry — the "nonce manager" integrity that
// keeps a bombard run's contiguous nonce range honest.
import { describe, it, expect } from 'vitest';
import { encodePlan, decodePlan, BOMBARD_PLAN_TTL_MS, type BombardPlan } from './draft';

function makePlan(overrides: Partial<BombardPlan> = {}): BombardPlan {
  return {
    v: 1,
    userId: 'user_1',
    runId: 'run_1',
    networkId: 'net_1',
    chainId: 31337,
    mode: 'CLIENT_SIGNED',
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    amountPerTxWei: '1',
    startNonce: 7,
    totalCount: 5,
    targetTps: 5,
    gas: '21000',
    maxFeePerGasWei: '1000000000',
    maxPriorityFeePerGasWei: '1000000000',
    exp: Date.now() + BOMBARD_PLAN_TTL_MS,
    ...overrides,
  };
}

describe('bombard plan token', () => {
  it('round-trips a valid plan verbatim', () => {
    const plan = makePlan();
    const result = decodePlan(encodePlan(plan));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan).toEqual(plan);
  });

  it('preserves the contiguous nonce range so tx i uses startNonce + i', () => {
    const plan = makePlan({ startNonce: 42, totalCount: 3 });
    const result = decodePlan(encodePlan(plan));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const nonces = Array.from(
        { length: result.plan.totalCount },
        (_, i) => result.plan.startNonce + i,
      );
      expect(nonces).toEqual([42, 43, 44]);
    }
  });

  it('rejects a tampered payload (bad signature)', () => {
    const token = encodePlan(makePlan({ amountPerTxWei: '1' }));
    const [payloadB64, mac] = token.split('.') as [string, string];
    // Re-encode the payload with an inflated per-tx value but keep the old MAC.
    const forged = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as BombardPlan;
    forged.amountPerTxWei = '1000000000000000000000';
    const forgedPayload = Buffer.from(JSON.stringify(forged), 'utf8').toString('base64url');
    const result = decodePlan(`${forgedPayload}.${mac}`);
    expect(result).toEqual({ ok: false, error: 'bad-signature' });
  });

  it('rejects a flipped nonce range that was not signed', () => {
    const token = encodePlan(makePlan({ startNonce: 7 }));
    const [payloadB64, mac] = token.split('.') as [string, string];
    const forged = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as BombardPlan;
    forged.startNonce = 0; // attempt to replay from nonce 0
    const forgedPayload = Buffer.from(JSON.stringify(forged), 'utf8').toString('base64url');
    expect(decodePlan(`${forgedPayload}.${mac}`)).toEqual({ ok: false, error: 'bad-signature' });
  });

  it('rejects a malformed token', () => {
    expect(decodePlan('not-a-token')).toEqual({ ok: false, error: 'malformed' });
    expect(decodePlan('.onlymac')).toEqual({ ok: false, error: 'malformed' });
    expect(decodePlan('onlypayload.')).toEqual({ ok: false, error: 'malformed' });
  });

  it('rejects an expired plan', () => {
    const plan = makePlan({ exp: Date.now() - 1 });
    const result = decodePlan(encodePlan(plan));
    expect(result).toEqual({ ok: false, error: 'expired' });
  });

  it('accepts a plan right up to its expiry boundary', () => {
    const now = 1_000_000;
    const plan = makePlan({ exp: now });
    const result = decodePlan(encodePlan(plan), now);
    expect(result.ok).toBe(true);
  });
});

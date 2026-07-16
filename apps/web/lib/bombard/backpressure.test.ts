import { describe, it, expect } from 'vitest';
import { BackpressureController, isBackpressureError } from './backpressure';

describe('BackpressureController', () => {
  it('multiplicatively reduces the rate on each pushback', () => {
    const bp = new BackpressureController(100, { decreaseFactor: 0.5, minRate: 1 });
    expect(bp.rate).toBe(100);
    bp.onPushback();
    expect(bp.rate).toBe(50);
    bp.onPushback();
    expect(bp.rate).toBe(25);
    expect(bp.throttled).toBe(true);
  });

  it('backs off exponentially across consecutive pushbacks', () => {
    const bp = new BackpressureController(100, { baseBackoffMs: 100, maxBackoffMs: 10_000 });
    expect(bp.onPushback()).toBe(100);
    expect(bp.onPushback()).toBe(200);
    expect(bp.onPushback()).toBe(400);
    expect(bp.onPushback()).toBe(800);
  });

  it('never drops below the floor rate', () => {
    const bp = new BackpressureController(2, { decreaseFactor: 0.5, minRate: 1 });
    bp.onPushback(); // 1
    bp.onPushback(); // floored at 1
    expect(bp.rate).toBe(1);
  });

  it('recovers the rate toward target on success but never above it', () => {
    const bp = new BackpressureController(100, { decreaseFactor: 0.5, increaseStep: 10 });
    bp.onPushback(); // 50
    bp.onPushback(); // 25
    bp.onSuccess(); // 35
    expect(bp.rate).toBe(35);
    for (let i = 0; i < 100; i += 1) bp.onSuccess();
    expect(bp.rate).toBe(100);
    expect(bp.throttled).toBe(false);
  });

  it('resets the backoff streak after a success', () => {
    const bp = new BackpressureController(100, { baseBackoffMs: 100 });
    bp.onPushback(); // streak 1
    bp.onPushback(); // streak 2 → 200
    bp.onSuccess(); // reset streak
    expect(bp.onPushback()).toBe(100); // back to base
  });
});

describe('isBackpressureError', () => {
  it('classifies HTTP 429 / 503 status as backpressure', () => {
    expect(isBackpressureError({ status: 429 })).toBe(true);
    expect(isBackpressureError({ status: 503 })).toBe(true);
  });

  it('classifies timeout / rate-limit / connection-reset messages as backpressure', () => {
    expect(isBackpressureError(new Error('request timed out'))).toBe(true);
    expect(isBackpressureError(new Error('429 Too Many Requests'))).toBe(true);
    expect(isBackpressureError(new Error('rate limit exceeded'))).toBe(true);
    expect(isBackpressureError(new Error('socket hang up'))).toBe(true);
  });

  it('does not classify a hard revert / nonce error as backpressure', () => {
    expect(isBackpressureError(new Error('execution reverted'))).toBe(false);
    expect(isBackpressureError(new Error('insufficient funds'))).toBe(false);
    expect(isBackpressureError(new Error('nonce too low'))).toBe(false);
  });
});

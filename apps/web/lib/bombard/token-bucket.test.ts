import { describe, it, expect } from 'vitest';
import { TokenBucket } from './token-bucket';

/**
 * Drives the bucket with a virtual clock: consume when a token is available,
 * otherwise advance the clock by exactly the reported wait. The emitted rate must
 * converge on the configured target within tolerance.
 */
function measureRate(ratePerSec: number, n: number, burst: number): number {
  const bucket = new TokenBucket(ratePerSec, burst, 0);
  let now = 0;
  let sent = 0;
  let guard = 0;
  while (sent < n) {
    if (guard++ > n * 1000) throw new Error('runaway pacing loop');
    const r = bucket.tryConsume(now);
    if (r.ok) sent += 1;
    else now += r.waitMs;
  }
  // n sends span (n-1) inter-arrival gaps of ~1/rate; the first is free.
  const elapsedSec = now / 1000;
  return (n - 1) / elapsedSec;
}

describe('TokenBucket', () => {
  it('paces a stream to ~targetTps (10 TPS)', () => {
    const measured = measureRate(10, 50, 1);
    expect(measured).toBeGreaterThan(9);
    expect(measured).toBeLessThan(11);
  });

  it('paces a stream to ~targetTps (100 TPS)', () => {
    const measured = measureRate(100, 500, 1);
    expect(measured).toBeGreaterThan(90);
    expect(measured).toBeLessThan(110);
  });

  it('permits an initial burst up to `burst` then settles to the rate', () => {
    const bucket = new TokenBucket(10, 5, 0);
    // Five tokens available immediately at t=0.
    for (let i = 0; i < 5; i += 1) expect(bucket.tryConsume(0).ok).toBe(true);
    // Sixth must wait ~1/rate.
    const sixth = bucket.tryConsume(0);
    expect(sixth.ok).toBe(false);
    expect(sixth.waitMs).toBeGreaterThan(0);
  });

  it('reducing the rate slows subsequent emission (backpressure hook)', () => {
    const bucket = new TokenBucket(100, 1, 0);
    bucket.tryConsume(0); // drain the burst token
    const before = bucket.tryConsume(0).waitMs; // wait at 100/s ≈ 10ms
    bucket.setRate(10, 0); // backpressure: 10/s
    const after = bucket.tryConsume(0).waitMs; // wait at 10/s ≈ 100ms
    expect(after).toBeGreaterThan(before);
  });

  it('rejects a non-positive rate', () => {
    expect(() => new TokenBucket(0)).toThrow();
    const b = new TokenBucket(10, 1, 0);
    expect(() => b.setRate(0, 0)).toThrow();
  });
});

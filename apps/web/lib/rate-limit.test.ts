import { beforeEach, describe, expect, it } from 'vitest';
import { InMemorySlidingWindowStore, RateLimiter, type RateLimitRule } from './rate-limit';

// A controllable clock so window expiry is deterministic (no real waiting).
let clock = 0;
const now = () => clock;

const rule: RateLimitRule = { limit: 3, windowSec: 10 };

let limiter: RateLimiter;
beforeEach(() => {
  clock = 1_000_000;
  limiter = new RateLimiter(new InMemorySlidingWindowStore(), now);
});

describe('sliding-window rate limiter', () => {
  it('allows up to the limit, then blocks', async () => {
    const key = 'rl:test:ip:1.2.3.4';
    expect((await limiter.consume(key, rule)).allowed).toBe(true); // 1
    expect((await limiter.consume(key, rule)).allowed).toBe(true); // 2
    const third = await limiter.consume(key, rule); // 3 (last allowed)
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const fourth = await limiter.consume(key, rule); // 4 → blocked
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterSec).toBeGreaterThan(0);
    expect(fourth.retryAfterSec).toBeLessThanOrEqual(rule.windowSec);
  });

  it('recovers after the window slides past the earliest hits', async () => {
    const key = 'rl:test:ip:5.6.7.8';
    await limiter.consume(key, rule);
    await limiter.consume(key, rule);
    await limiter.consume(key, rule);
    expect((await limiter.consume(key, rule)).allowed).toBe(false);

    // Advance just past the window: the 3 earlier hits fall out of range.
    clock += rule.windowSec * 1000 + 1;
    const recovered = await limiter.consume(key, rule);
    expect(recovered.allowed).toBe(true);
    expect(recovered.remaining).toBe(rule.limit - 1);
  });

  it('slides partially: only expired hits are forgotten', async () => {
    const key = 'rl:test:ip:9.9.9.9';
    await limiter.consume(key, rule); // t0
    clock += 4000;
    await limiter.consume(key, rule); // t0+4s
    await limiter.consume(key, rule); // t0+4s
    expect((await limiter.consume(key, rule)).allowed).toBe(false); // at cap

    // Move to t0+11s: only the first hit (t0) expires → one slot frees up.
    clock += 7000;
    expect((await limiter.consume(key, rule)).allowed).toBe(true);
    // Now back at cap (2 remaining from t0+4s window + this one).
    expect((await limiter.consume(key, rule)).allowed).toBe(false);
  });

  it('peek does not consume; record increments; reset clears', async () => {
    const key = 'rl:test:user:alice';
    // peek on empty → allowed, full remaining, no state change.
    const p0 = await limiter.peek(key, rule);
    expect(p0.allowed).toBe(true);
    expect(p0.remaining).toBe(rule.limit);
    expect((await limiter.peek(key, rule)).remaining).toBe(rule.limit); // still full

    // record three failures → now at/over cap.
    await limiter.record(key, rule);
    await limiter.record(key, rule);
    await limiter.record(key, rule);
    expect((await limiter.peek(key, rule)).allowed).toBe(false);

    // reset clears the counter.
    await limiter.reset(key);
    expect((await limiter.peek(key, rule)).allowed).toBe(true);
  });
});

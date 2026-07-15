// Reusable Redis sliding-window rate limiter (SPEC §4.3/§13, AGENT.md §5).
//
// SERVER-ONLY. Generalizes the Sprint-#4 login-failure limiter into one keyable
// limiter used across login / faucet / deploy / transfer / bombard / chat /
// userops, keyed per-user, per-IP, or per-address. The window is a Redis sorted
// set of hit timestamps (ms); on every operation we trim entries older than the
// window and count what remains — a true sliding window, not a coarse fixed
// bucket.
//
// Testability: the Redis wiring lives behind {@link SlidingWindowStore}, so the
// decision logic is exercised against an in-memory store with a controllable
// clock in unit tests (no live Redis needed — CI has none).
//
// Availability: the module-level helpers FAIL OPEN on any store error. A Redis
// outage must degrade abuse protection, not lock every user out or hang requests
// (the trade-off documented in AGENT.md §5).
import { randomBytes } from 'node:crypto';
import { getRedis } from '@/lib/redis';

export interface RateLimitRule {
  /** Max hits permitted within the window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  /** Hits still available in the current window (0 when blocked). */
  remaining: number;
  /** Seconds until the caller may retry (0 when allowed). */
  retryAfterSec: number;
}

/**
 * Backing store for the sliding window. Each key holds a set of hit timestamps
 * (ms since epoch). Implementations MUST drop entries at/older than `cutoffMs`
 * when reading so the window truly slides.
 */
export interface SlidingWindowStore {
  /** Trim entries at/older than `cutoffMs`, then return remaining timestamps ascending. */
  windowScores(key: string, cutoffMs: number): Promise<number[]>;
  /** Append a hit at `scoreMs` and (re)arm the key TTL to `ttlMs`. */
  addHit(key: string, scoreMs: number, ttlMs: number): Promise<void>;
  /** Remove the key entirely (used to reset a counter, e.g. on login success). */
  clear(key: string): Promise<void>;
}

/** Redis (ioredis) sorted-set implementation of the sliding-window store. */
export class RedisSlidingWindowStore implements SlidingWindowStore {
  async windowScores(key: string, cutoffMs: number): Promise<number[]> {
    const redis = getRedis();
    const pipe = redis.multi();
    // Drop everything up to and including the cutoff, then read what's left.
    pipe.zremrangebyscore(key, 0, cutoffMs);
    pipe.zrange(key, 0, -1, 'WITHSCORES');
    const res = await pipe.exec();
    const flat = (res?.[1]?.[1] ?? []) as string[];
    const scores: number[] = [];
    // zrange WITHSCORES returns [member, score, member, score, …].
    for (let i = 1; i < flat.length; i += 2) scores.push(Number(flat[i]));
    return scores;
  }

  async addHit(key: string, scoreMs: number, ttlMs: number): Promise<void> {
    const redis = getRedis();
    // Member must be unique so concurrent hits in the same millisecond both land.
    const member = `${scoreMs}-${randomBytes(6).toString('hex')}`;
    const pipe = redis.multi();
    pipe.zadd(key, scoreMs, member);
    pipe.pexpire(key, ttlMs);
    await pipe.exec();
  }

  async clear(key: string): Promise<void> {
    await getRedis().del(key);
  }
}

/** In-memory store for unit tests (no Redis). Not for production use. */
export class InMemorySlidingWindowStore implements SlidingWindowStore {
  private readonly data = new Map<string, number[]>();

  async windowScores(key: string, cutoffMs: number): Promise<number[]> {
    const kept = (this.data.get(key) ?? []).filter((s) => s > cutoffMs).sort((a, b) => a - b);
    this.data.set(key, kept);
    return kept;
  }

  async addHit(key: string, scoreMs: number): Promise<void> {
    const arr = this.data.get(key) ?? [];
    arr.push(scoreMs);
    this.data.set(key, arr);
  }

  async clear(key: string): Promise<void> {
    this.data.delete(key);
  }
}

/**
 * The limiter itself. Stateless apart from its store + clock, so it composes
 * cleanly and is fully deterministic under test (inject a fake `now`).
 */
export class RateLimiter {
  constructor(
    private readonly store: SlidingWindowStore,
    private readonly now: () => number = Date.now,
  ) {}

  private decide(
    scores: number[],
    rule: RateLimitRule,
    now: number,
  ): { allowed: boolean; remaining: number; retryAfterSec: number } {
    if (scores.length >= rule.limit) {
      const oldest = scores[0] ?? now;
      const retryMs = oldest + rule.windowSec * 1000 - now;
      return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil(retryMs / 1000)) };
    }
    return { allowed: true, remaining: Math.max(0, rule.limit - scores.length), retryAfterSec: 0 };
  }

  /** Check-and-consume: records a hit iff under the limit. Use per request. */
  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const now = this.now();
    const scores = await this.store.windowScores(key, now - rule.windowSec * 1000);
    const d = this.decide(scores, rule, now);
    if (d.allowed) {
      await this.store.addHit(key, now, rule.windowSec * 1000);
      d.remaining = Math.max(0, d.remaining - 1);
    }
    return { limit: rule.limit, ...d };
  }

  /** Non-mutating read: is the key currently at/over its limit? */
  async peek(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const now = this.now();
    const scores = await this.store.windowScores(key, now - rule.windowSec * 1000);
    return { limit: rule.limit, ...this.decide(scores, rule, now) };
  }

  /** Record a hit without a pre-check (the failure-counter increment pattern). */
  async record(key: string, rule: RateLimitRule): Promise<void> {
    await this.store.addHit(key, this.now(), rule.windowSec * 1000);
  }

  /** Clear a key's window (e.g. reset a user's failure counter after success). */
  async reset(key: string): Promise<void> {
    await this.store.clear(key);
  }
}

/** Named rules for the abuse-prone surfaces (SPEC §13). Tune here, reuse everywhere. */
export const RATE_LIMITS = {
  loginPerUsername: { limit: 5, windowSec: 60 },
  loginPerIp: { limit: 20, windowSec: 60 },
  faucet: { limit: 5, windowSec: 60 },
  deploy: { limit: 10, windowSec: 60 },
  transfer: { limit: 30, windowSec: 60 },
  bombard: { limit: 5, windowSec: 60 },
  chat: { limit: 30, windowSec: 60 },
  userops: { limit: 20, windowSec: 60 },
} satisfies Record<string, RateLimitRule>;

/** Build a namespaced limiter key, e.g. `rl:faucet:ip:1.2.3.4`. */
export function rateLimitKey(scope: string, ...parts: string[]): string {
  return `rl:${scope}:${parts.map((p) => p.trim().toLowerCase()).join(':')}`;
}

const defaultLimiter = new RateLimiter(new RedisSlidingWindowStore());

function failOpen(rule: RateLimitRule): RateLimitResult {
  return { allowed: true, limit: rule.limit, remaining: rule.limit, retryAfterSec: 0 };
}

/** Check-and-consume against the shared Redis limiter. Fails open on Redis error. */
export async function consumeRateLimit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  try {
    return await defaultLimiter.consume(key, rule);
  } catch {
    return failOpen(rule);
  }
}

/** Non-mutating limit check against the shared Redis limiter. Fails open. */
export async function peekRateLimit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  try {
    return await defaultLimiter.peek(key, rule);
  } catch {
    return failOpen(rule);
  }
}

/** Record a hit against the shared Redis limiter (best-effort). */
export async function recordRateLimitHit(key: string, rule: RateLimitRule): Promise<void> {
  try {
    await defaultLimiter.record(key, rule);
  } catch {
    // best-effort; limiting must never break the request
  }
}

/** Reset a key against the shared Redis limiter (best-effort). */
export async function resetRateLimit(key: string): Promise<void> {
  try {
    await defaultLimiter.reset(key);
  } catch {
    // best-effort
  }
}

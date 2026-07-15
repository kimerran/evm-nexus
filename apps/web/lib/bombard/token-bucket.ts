// Token-bucket pacer for the bombard runner (SPEC §9). PURE + dependency-free so
// it is exercised directly under Vitest with a controllable clock (no timers, no
// Redis). The runner drives it: `tryConsume(now)` reports whether a token is
// available and, if not, how long to sleep before the next one. Sizing the bucket
// to `ratePerSec` makes the emitted transaction stream converge on the target TPS.
//
// The `rate` is mutable so the backpressure controller can shrink it on RPC 429/
// timeout (reducing throughput) and grow it back on recovery — all without
// resetting accrued tokens.

/** Result of attempting to consume one token at a given instant. */
export interface ConsumeResult {
  /** True when a token was available and has been consumed. */
  ok: boolean;
  /** When `ok` is false, ms to wait before a token will be available (>0). */
  waitMs: number;
}

/**
 * A classic token bucket. Tokens accrue continuously at `rate` tokens/second up
 * to `burst`; each emitted tx consumes one. Starting full (`tokens = burst`)
 * permits a small initial burst, after which the long-run emit rate equals
 * `rate`.
 */
export class TokenBucket {
  private tokens: number;
  private rate: number;
  private readonly burst: number;
  private last: number;

  constructor(ratePerSec: number, burst = 1, startMs = 0, startTokens?: number) {
    if (ratePerSec <= 0) throw new Error('token bucket rate must be > 0');
    this.rate = ratePerSec;
    this.burst = Math.max(1, burst);
    // Default to a full bucket (permits an initial burst). Pass `startTokens = 0`
    // to start EMPTY so a run's long-run rate converges tightly on the target
    // without an opening overshoot; the burst capacity is then reserved purely
    // for catch-up after a stall (e.g. a slow RPC send at high TPS).
    this.tokens = Math.min(this.burst, Math.max(0, startTokens ?? this.burst));
    this.last = startMs;
  }

  /** Current effective rate (tokens/sec). */
  get ratePerSec(): number {
    return this.rate;
  }

  /** Refill tokens for the elapsed time since the last accounting instant. */
  private refill(nowMs: number): void {
    if (nowMs <= this.last) return;
    const elapsedSec = (nowMs - this.last) / 1000;
    this.tokens = Math.min(this.burst, this.tokens + elapsedSec * this.rate);
    this.last = nowMs;
  }

  /**
   * Change the emit rate (backpressure). Accrues tokens at the OLD rate up to
   * `nowMs` first, so a rate change never retroactively grants/loses tokens.
   */
  setRate(ratePerSec: number, nowMs: number): void {
    if (ratePerSec <= 0) throw new Error('token bucket rate must be > 0');
    this.refill(nowMs);
    this.rate = ratePerSec;
  }

  /**
   * Try to consume one token at `nowMs`. On success returns `{ ok: true }`; on
   * failure returns the ms until the next whole token accrues so the caller can
   * sleep exactly that long.
   */
  tryConsume(nowMs: number): ConsumeResult {
    this.refill(nowMs);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { ok: true, waitMs: 0 };
    }
    const deficit = 1 - this.tokens;
    const waitMs = Math.max(1, Math.ceil((deficit / this.rate) * 1000));
    return { ok: false, waitMs };
  }
}

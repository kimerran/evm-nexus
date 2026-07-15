// Adaptive backpressure controller for the bombard runner (SPEC §9). PURE +
// dependency-free (unit-tested directly). When the RPC pushes back (HTTP 429 /
// timeout) the runner must REDUCE effective throughput and back off — never fail
// the whole run. On sustained success it recovers the rate back toward the target.
//
// This owns only the arithmetic (AIMD-style: multiplicative decrease on pushback,
// additive increase on success) + an exponential backoff sleep hint. The runner
// feeds the resulting `rate` into the token bucket.

export interface BackpressureOptions {
  /** Floor the effective rate never drops below (keeps the run alive). */
  minRate?: number;
  /** Multiplier applied to the rate on each pushback (0<f<1). */
  decreaseFactor?: number;
  /** Tokens/sec added back per successful recovery step. */
  increaseStep?: number;
  /** Base backoff (ms) for the first pushback; doubles each consecutive one. */
  baseBackoffMs?: number;
  /** Cap on the exponential backoff (ms). */
  maxBackoffMs?: number;
}

/** Adaptive-rate controller: multiplicative decrease, additive increase. */
export class BackpressureController {
  private readonly target: number;
  private readonly minRate: number;
  private readonly decreaseFactor: number;
  private readonly increaseStep: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  private currentRate: number;
  /** Consecutive pushbacks — drives the exponential backoff. */
  private consecutivePushbacks = 0;

  constructor(targetRate: number, opts: BackpressureOptions = {}) {
    if (targetRate <= 0) throw new Error('target rate must be > 0');
    this.target = targetRate;
    this.minRate = Math.max(0.1, opts.minRate ?? 1);
    this.decreaseFactor = opts.decreaseFactor ?? 0.5;
    this.increaseStep = opts.increaseStep ?? Math.max(1, targetRate * 0.1);
    this.baseBackoffMs = opts.baseBackoffMs ?? 250;
    this.maxBackoffMs = opts.maxBackoffMs ?? 10_000;
    this.currentRate = targetRate;
  }

  /** Current effective rate (tokens/sec) to feed the token bucket. */
  get rate(): number {
    return this.currentRate;
  }

  /** True once the rate has been throttled below target by pushback. */
  get throttled(): boolean {
    return this.currentRate < this.target;
  }

  /**
   * Record RPC pushback (429/timeout). Multiplicatively reduces the rate (never
   * below `minRate`) and returns an exponentially growing backoff to sleep.
   */
  onPushback(): number {
    this.currentRate = Math.max(this.minRate, this.currentRate * this.decreaseFactor);
    const backoff = Math.min(
      this.maxBackoffMs,
      this.baseBackoffMs * 2 ** this.consecutivePushbacks,
    );
    this.consecutivePushbacks += 1;
    return backoff;
  }

  /**
   * Record a successful send. Clears the pushback streak and additively recovers
   * the rate toward — but never above — the target.
   */
  onSuccess(): void {
    this.consecutivePushbacks = 0;
    if (this.currentRate < this.target) {
      this.currentRate = Math.min(this.target, this.currentRate + this.increaseStep);
    }
  }
}

/**
 * Classify a thrown RPC error as backpressure (retry + slow down) vs a hard
 * failure (record + advance). PURE so both the runner and its tests agree.
 */
export function isBackpressureError(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  if (typeof status === 'number' && (status === 429 || status === 503)) return true;
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    message.includes('429') ||
    message.includes('too many request') ||
    message.includes('rate limit') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    message.includes('service unavailable')
  );
}

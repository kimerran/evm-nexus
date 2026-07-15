// Readiness aggregation for the public /api/health probe (SPEC §8.11, §14).
//
// SERVER-ONLY but dependency-free of Next — pure functions + small runners so the
// aggregation logic is unit testable. A readiness check runs each dependency
// (Postgres, Redis, active-network RPC) under a timeout and reduces the results
// to a single 200 (all up) / 503 (any down) verdict with a per-dependency
// breakdown. Error detail is reduced to a coarse, secret-free label — this
// endpoint is PUBLIC, so it must never echo a connection string or stack.

/** The dependencies reflected by the readiness probe. */
export type CheckName = 'db' | 'redis' | 'rpc';

/** Result of probing one dependency. */
export interface DependencyCheck {
  ok: boolean;
  /** Round-trip time for the probe in ms (best effort). */
  latencyMs: number;
  /** Coarse, leak-free failure label — only present when `ok` is false. */
  error?: 'timeout' | 'unavailable';
}

export type ReadinessChecks = Record<CheckName, DependencyCheck>;

/** Aggregated readiness verdict returned to the caller. */
export interface ReadinessReport {
  status: 'ok' | 'unhealthy';
  httpStatus: 200 | 503;
  checks: ReadinessChecks;
}

/** Marker used to distinguish an internal timeout from a dependency error. */
class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Race a promise against a timeout, rejecting with a {@link TimeoutError} if it
 * does not settle in time. Prevents a hung dependency (e.g. an RPC pointed at a
 * dead port that never RSTs) from stalling the whole health probe.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Reduce any thrown value to a coarse, secret-free failure label. */
export function errorLabel(err: unknown): 'timeout' | 'unavailable' {
  return err instanceof TimeoutError ? 'timeout' : 'unavailable';
}

/**
 * Run a single dependency probe under a timeout, capturing latency and mapping
 * failure to a coarse label. Never throws — always resolves to a
 * {@link DependencyCheck}.
 */
export async function runCheck(
  probe: () => Promise<unknown>,
  timeoutMs = 3000,
): Promise<DependencyCheck> {
  const start = Date.now();
  try {
    await withTimeout(probe(), timeoutMs);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: errorLabel(err) };
  }
}

/**
 * Reduce per-dependency checks to a single verdict: healthy only when EVERY
 * dependency is up. Maps to HTTP 200 (ready) or 503 (a dependency is down) so
 * Railway/orchestrators can gate traffic on it.
 */
export function aggregateReadiness(checks: ReadinessChecks): ReadinessReport {
  const healthy = Object.values(checks).every((check) => check.ok);
  return {
    status: healthy ? 'ok' : 'unhealthy',
    httpStatus: healthy ? 200 : 503,
    checks,
  };
}

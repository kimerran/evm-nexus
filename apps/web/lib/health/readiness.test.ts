import { describe, expect, it } from 'vitest';
import {
  aggregateReadiness,
  errorLabel,
  runCheck,
  withTimeout,
  type ReadinessChecks,
} from './readiness';

const up = { ok: true, latencyMs: 1 } as const;
const down = { ok: false, latencyMs: 1, error: 'unavailable' } as const;

describe('aggregateReadiness', () => {
  it('is 200/ok only when every dependency is up', () => {
    const checks: ReadinessChecks = { db: up, redis: up, rpc: up };
    const report = aggregateReadiness(checks);
    expect(report.status).toBe('ok');
    expect(report.httpStatus).toBe(200);
  });

  it('flips to 503/unhealthy when any single dependency is down', () => {
    const checks: ReadinessChecks = { db: up, redis: up, rpc: down };
    const report = aggregateReadiness(checks);
    expect(report.status).toBe('unhealthy');
    expect(report.httpStatus).toBe(503);
    expect(report.checks.rpc.ok).toBe(false);
  });

  it('reports 503 when all are down and preserves the breakdown', () => {
    const checks: ReadinessChecks = { db: down, redis: down, rpc: down };
    expect(aggregateReadiness(checks).httpStatus).toBe(503);
    expect(aggregateReadiness(checks).checks).toBe(checks);
  });
});

describe('withTimeout', () => {
  it('resolves when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('v'), 50)).resolves.toBe('v');
  });

  it('rejects with a timeout when the promise hangs', async () => {
    const hang = new Promise<never>(() => {});
    await expect(withTimeout(hang, 10)).rejects.toThrow(/timed out/);
  });

  it('propagates the underlying rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50)).rejects.toThrow('boom');
  });
});

describe('runCheck', () => {
  it('reports ok with latency for a passing probe', async () => {
    const check = await runCheck(async () => 'pong');
    expect(check.ok).toBe(true);
    expect(check.latencyMs).toBeGreaterThanOrEqual(0);
    expect(check.error).toBeUndefined();
  });

  it('reports a coarse "unavailable" label for a failing probe', async () => {
    const check = await runCheck(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:9999');
    });
    expect(check.ok).toBe(false);
    expect(check.error).toBe('unavailable');
  });

  it('reports "timeout" when the probe exceeds the deadline', async () => {
    const check = await runCheck(() => new Promise<never>(() => {}), 10);
    expect(check.ok).toBe(false);
    expect(check.error).toBe('timeout');
  });

  it('never leaks the raw error message', async () => {
    const secret = 'postgres://user:SECRET@host/db';
    const check = await runCheck(async () => {
      throw new Error(secret);
    });
    expect(JSON.stringify(check)).not.toContain('SECRET');
  });
});

describe('errorLabel', () => {
  it('classifies non-timeout errors as unavailable', () => {
    expect(errorLabel(new Error('nope'))).toBe('unavailable');
    expect(errorLabel('string error')).toBe('unavailable');
  });
});

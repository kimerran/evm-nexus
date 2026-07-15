import { describe, it, expect } from 'vitest';
import { parseEnv } from './env';

const validEnv = {
  APP_URL: 'http://localhost:3000',
  SESSION_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: 'y'.repeat(32),
  CSRF_SECRET: 'z'.repeat(16),
  DATABASE_URL: 'postgresql://nexus:nexus@localhost:5432/evm_nexus',
  REDIS_URL: 'redis://localhost:6379',
};

describe('parseEnv', () => {
  it('rejects a missing required variable', () => {
    const { SESSION_SECRET: _omitted, ...missing } = validEnv;
    expect(() => parseEnv(missing)).toThrowError(/SESSION_SECRET/);
  });

  it('rejects a too-short secret', () => {
    expect(() => parseEnv({ ...validEnv, SESSION_SECRET: 'short' })).toThrowError(
      /SESSION_SECRET/,
    );
  });

  it('accepts a complete config and applies defaults', () => {
    const env = parseEnv(validEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.STORAGE_DRIVER).toBe('volume');
    expect(env.DEFAULT_CHAIN_ID).toBe(31337);
    expect(env.BOMBARD_MAX_TPS).toBe(1000);
  });

  it('coerces numeric and boolean vars', () => {
    const env = parseEnv({ ...validEnv, DEFAULT_CHAIN_ID: '1', S3_FORCE_PATH_STYLE: 'false' });
    expect(env.DEFAULT_CHAIN_ID).toBe(1);
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
  });
});

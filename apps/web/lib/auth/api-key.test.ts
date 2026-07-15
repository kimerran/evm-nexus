import { beforeAll, describe, expect, it } from 'vitest';

// api-key.ts imports the Prisma singleton (which reads validated env at module
// load), so provide a minimal valid env before importing it.
beforeAll(() => {
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.SESSION_SECRET ??= 's'.repeat(40);
  process.env.ENCRYPTION_KEY ??= 'k'.repeat(32);
  process.env.CSRF_SECRET ??= 'c'.repeat(16);
  process.env.DATABASE_URL ??= 'postgresql://nexus:nexus@localhost:5432/evm_nexus';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
});

describe('API key format / hash / parse', () => {
  it('generates a nxs_ token with matching sha256 hash and display prefix', async () => {
    const { API_KEY_PREFIX, generateApiKey, hashApiKey } = await import('./api-key');
    const { token, keyHash, prefix } = generateApiKey();
    expect(token.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(keyHash).toBe(hashApiKey(token));
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(keyHash).not.toContain(token); // hash never contains the raw key
    expect(token.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBeLessThan(token.length); // prefix is a display slice
  });

  it('produces a distinct token+hash each call', async () => {
    const { generateApiKey } = await import('./api-key');
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.token).not.toBe(b.token);
    expect(a.keyHash).not.toBe(b.keyHash);
  });

  it('hashing is deterministic', async () => {
    const { hashApiKey } = await import('./api-key');
    expect(hashApiKey('nxs_abc')).toBe(hashApiKey('nxs_abc'));
  });

  it('parses a well-formed Bearer nxs_ header (case-insensitive scheme)', async () => {
    const { parseApiKeyFromHeader } = await import('./api-key');
    expect(parseApiKeyFromHeader('Bearer nxs_abc123')).toBe('nxs_abc123');
    expect(parseApiKeyFromHeader('bearer nxs_abc123')).toBe('nxs_abc123');
  });

  it('rejects non-nxs bearer tokens and malformed headers', async () => {
    const { parseApiKeyFromHeader } = await import('./api-key');
    expect(parseApiKeyFromHeader('Bearer some-jwt')).toBeNull();
    expect(parseApiKeyFromHeader('nxs_no_scheme')).toBeNull();
    expect(parseApiKeyFromHeader('Basic nxs_abc')).toBeNull();
    expect(parseApiKeyFromHeader(null)).toBeNull();
    expect(parseApiKeyFromHeader('')).toBeNull();
  });
});

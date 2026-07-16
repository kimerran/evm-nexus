import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.SESSION_SECRET ??= 's'.repeat(32);
  process.env.ENCRYPTION_KEY ??= 'k'.repeat(32);
  process.env.CSRF_SECRET ??= 'c'.repeat(16);
  process.env.DATABASE_URL ??= 'postgresql://nexus:nexus@localhost:5432/evm_nexus';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
});

const CREDENTIALED = 'https://alice:s3cr3t@rpc.example.com/v1/abc123';
const PLAIN = 'http://localhost:8545';

describe('rpc-url secret handling', () => {
  it('detects a userinfo credential', async () => {
    const { hasUrlCredential } = await import('./rpc-url');
    expect(hasUrlCredential(CREDENTIALED)).toBe(true);
    expect(hasUrlCredential(PLAIN)).toBe(false);
  });

  it('encrypts a credentialed URL at rest and round-trips it', async () => {
    const { encodeRpcUrlForStorage, decodeRpcUrlFromStorage, isEncodedRpcUrl } = await import(
      './rpc-url'
    );
    const stored = encodeRpcUrlForStorage(CREDENTIALED);
    expect(isEncodedRpcUrl(stored)).toBe(true);
    // The stored envelope must NOT contain the plaintext secret.
    expect(stored).not.toContain('s3cr3t');
    expect(stored).not.toContain('alice');
    expect(decodeRpcUrlFromStorage(stored)).toBe(CREDENTIALED);
  });

  it('stores a credential-free URL verbatim (no encryption)', async () => {
    const { encodeRpcUrlForStorage, isEncodedRpcUrl, decodeRpcUrlFromStorage } = await import(
      './rpc-url'
    );
    const stored = encodeRpcUrlForStorage(PLAIN);
    expect(isEncodedRpcUrl(stored)).toBe(false);
    expect(stored).toBe(PLAIN);
    expect(decodeRpcUrlFromStorage(stored)).toBe(PLAIN);
  });

  it('redacts to origin only — dropping userinfo, path and query', async () => {
    const { redactRpcUrl } = await import('./rpc-url');
    const redacted = redactRpcUrl(CREDENTIALED);
    expect(redacted).toBe('https://rpc.example.com');
    expect(redacted).not.toContain('s3cr3t');
    expect(redacted).not.toContain('alice');
    expect(redacted).not.toContain('abc123');
  });
});

import { beforeAll, describe, expect, it } from 'vitest';

// The helper reads ENCRYPTION_KEY through the validated env module at call time,
// so provide a minimal valid env before importing it.
beforeAll(() => {
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.SESSION_SECRET ??= 's'.repeat(32);
  process.env.ENCRYPTION_KEY ??= 'k'.repeat(32); // passphrase-style → scrypt-derived
  process.env.CSRF_SECRET ??= 'c'.repeat(16);
  process.env.DATABASE_URL ??= 'postgresql://nexus:nexus@localhost:5432/evm_nexus';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
});

describe('at-rest encryption', () => {
  it('round-trips a secret (encrypt → decrypt)', async () => {
    const { encryptAtRest, decryptAtRest } = await import('./at-rest');
    const plaintext = 'https://user:s3cr3t@rpc.example.com/v1/abc123';
    const envelope = encryptAtRest(plaintext);
    expect(decryptAtRest(envelope)).toBe(plaintext);
  });

  it('never stores the plaintext in the ciphertext envelope', async () => {
    const { encryptAtRest } = await import('./at-rest');
    const secret = 'super-secret-rpc-credential';
    const envelope = encryptAtRest(secret);
    expect(envelope.startsWith('v1.')).toBe(true);
    expect(envelope).not.toContain(secret);
  });

  it('produces a fresh IV each call (ciphertexts differ)', async () => {
    const { encryptAtRest } = await import('./at-rest');
    const a = encryptAtRest('same-input');
    const b = encryptAtRest('same-input');
    expect(a).not.toBe(b);
  });

  it('rejects a tampered ciphertext (auth tag fails)', async () => {
    const { encryptAtRest, decryptAtRest } = await import('./at-rest');
    const envelope = encryptAtRest('integrity-protected');
    const raw = Buffer.from(envelope.slice('v1.'.length), 'base64');
    const last = raw.length - 1;
    raw[last] = (raw[last] ?? 0) ^ 0xff; // flip a ciphertext byte
    const tampered = `v1.${raw.toString('base64')}`;
    expect(() => decryptAtRest(tampered)).toThrow();
  });

  it('rejects a malformed envelope', async () => {
    const { decryptAtRest } = await import('./at-rest');
    expect(() => decryptAtRest('not-a-valid-envelope')).toThrow();
    expect(() => decryptAtRest('v2.abcd')).toThrow();
  });
});

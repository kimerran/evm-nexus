import { describe, expect, it } from 'vitest';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './password';

describe('argon2id password hashing', () => {
  it('hashes to an argon2id digest that is not the plaintext', async () => {
    const digest = await hashPassword('correct horse battery staple');
    expect(digest.startsWith('$argon2id$')).toBe(true);
    expect(digest).not.toContain('correct horse battery staple');
  });

  it('verifies the correct password', async () => {
    const digest = await hashPassword('S3cure-Passw0rd!');
    await expect(verifyPassword(digest, 'S3cure-Passw0rd!')).resolves.toBe(true);
  });

  it('rejects the wrong password (wrong-password path)', async () => {
    const digest = await hashPassword('S3cure-Passw0rd!');
    await expect(verifyPassword(digest, 'wrong-password')).resolves.toBe(false);
  });

  it('produces a distinct digest per call (random salt)', async () => {
    const a = await hashPassword('same-input');
    const b = await hashPassword('same-input');
    expect(a).not.toBe(b);
  });

  it('returns false (never throws) for a malformed digest', async () => {
    await expect(verifyPassword('not-a-real-hash', 'whatever')).resolves.toBe(false);
  });

  it('has a usable dummy hash for user-enumeration timing defense', async () => {
    expect(DUMMY_PASSWORD_HASH.startsWith('$argon2id$')).toBe(true);
    // Verifies successfully against nothing a real user would type.
    await expect(verifyPassword(DUMMY_PASSWORD_HASH, 'any-guess')).resolves.toBe(false);
  });
});

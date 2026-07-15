import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import {
  decryptKeystore,
  encryptKeystore,
  generateKeypair,
  KeystoreError,
} from './keystore';

// These tests exercise the PRIME-DIRECTIVE crypto (AGENT.md §0/§6, SPEC §4.1).
// Node ≥ 20 exposes WebCrypto (`globalThis.crypto.subtle`), so the same code path
// the browser runs is covered here. Iterations are the real 600k — a couple of
// derivations per test is well within the test budget.

const PASSPHRASE = 'correct horse battery staple';

describe('keystore crypto (client, WebCrypto)', () => {
  it('generateKeypair returns a checksummed address matching its private key', () => {
    const { address, privateKey } = generateKeypair();
    expect(privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(privateKeyToAccount(privateKey).address).toBe(address);
  });

  it('the encrypted blob NEVER contains the plaintext private key', async () => {
    const { privateKey } = generateKeypair();
    const keystore = await encryptKeystore(privateKey, PASSPHRASE);

    const serialized = JSON.stringify(keystore);
    const bare = privateKey.slice(2).toLowerCase();
    // Neither the 0x-prefixed nor the bare hex key may appear anywhere in the blob.
    expect(serialized.toLowerCase()).not.toContain(privateKey.toLowerCase());
    expect(serialized.toLowerCase()).not.toContain(bare);
    // And the blob is a real ciphertext envelope, not a raw key.
    expect(keystore.version).toBe(3);
    expect(keystore.crypto.cipher).toBe('aes-256-gcm');
    expect(keystore.crypto.kdf).toBe('pbkdf2');
    expect(keystore.crypto.kdfparams.c).toBeGreaterThanOrEqual(600_000);
    expect(keystore.crypto.ciphertext).not.toContain(bare);
  });

  it('encrypt → decrypt round-trips to the SAME address and key', async () => {
    const original = generateKeypair();
    const keystore = await encryptKeystore(original.privateKey, PASSPHRASE);
    const decrypted = await decryptKeystore(keystore, PASSPHRASE);

    expect(decrypted.address).toBe(original.address);
    expect(decrypted.privateKey).toBe(original.privateKey);
    expect(`0x${keystore.address}`.toLowerCase()).toBe(original.address.toLowerCase());
  });

  it('a WRONG passphrase fails cleanly (typed KeystoreError, no leak)', async () => {
    const { privateKey } = generateKeypair();
    const keystore = await encryptKeystore(privateKey, PASSPHRASE);

    await expect(decryptKeystore(keystore, 'not the passphrase')).rejects.toBeInstanceOf(
      KeystoreError,
    );
    await expect(decryptKeystore(keystore, 'not the passphrase')).rejects.toMatchObject({
      code: 'DECRYPT_FAILED',
    });
  });

  it('rejects a non-keystore / malformed blob as INVALID_KEYSTORE', async () => {
    await expect(decryptKeystore({ not: 'a keystore' }, PASSPHRASE)).rejects.toMatchObject({
      code: 'INVALID_KEYSTORE',
    });
  });

  it('a tampered ciphertext fails cleanly (GCM/mac reject)', async () => {
    const { privateKey } = generateKeypair();
    const keystore = await encryptKeystore(privateKey, PASSPHRASE);
    // Flip a nibble in the ciphertext.
    const first = keystore.crypto.ciphertext[0] === 'a' ? 'b' : 'a';
    const tampered = {
      ...keystore,
      crypto: { ...keystore.crypto, ciphertext: `${first}${keystore.crypto.ciphertext.slice(1)}` },
    };
    await expect(decryptKeystore(tampered, PASSPHRASE)).rejects.toMatchObject({
      code: 'DECRYPT_FAILED',
    });
  });
});

'use client';

// Client-side keystore crypto — THE PRIME DIRECTIVE lives here (AGENT.md §0/§6,
// SPEC §4.1). Keypairs are generated, encrypted, and decrypted ONLY in the
// browser; the plaintext private key never leaves this module's memory and never
// touches the network, storage, or a server import.
//
// BROWSER-ONLY. No `process.env`, no server imports, no secrets baked in. Uses
// WebCrypto (`crypto.subtle`) — available in the browser and, for unit tests, in
// Node ≥ 20 via `globalThis.crypto`. Runs fine in a Web Worker too.
//
// Crypto choice (documented, dependency-free): PBKDF2-SHA-512 @ 600k iterations
// (WebCrypto-native, so no extra WASM dependency) → AES-256-GCM. The output is a
// Web3-Secret-Storage-v3-shaped JSON envelope holding ONLY ciphertext + public
// KDF/cipher params — never the plaintext key.
import { bytesToHex, hexToBytes, keccak256, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { EncryptedKeystoreV3 } from './keystore-schema';
import { keystoreV3Schema } from './keystore-schema';

// --- KDF / cipher parameters (SPEC §4.1) ---
const PBKDF2_ITERATIONS = 600_000; // ≥ 600k per SPEC
const PBKDF2_HASH = 'SHA-512';
const DK_LEN = 32; // 256-bit derived key for AES-256
const SALT_BYTES = 32;
const IV_BYTES = 12; // 96-bit GCM nonce (standard)
const TAG_BYTES = 16; // 128-bit GCM auth tag

/**
 * Typed, non-leaking keystore error. Wrong passphrase / tampered blob surface as
 * this (caught, never a raw throw that could leak internals). The message is
 * deliberately generic.
 */
export class KeystoreError extends Error {
  readonly code: 'DECRYPT_FAILED' | 'INVALID_KEYSTORE';
  constructor(code: 'DECRYPT_FAILED' | 'INVALID_KEYSTORE', message: string) {
    super(message);
    this.name = 'KeystoreError';
    this.code = code;
  }
}

/** An in-memory keypair. The `privateKey` stays in memory only — never persisted. */
export interface GeneratedKeypair {
  address: Address;
  /** 0x-prefixed 32-byte private key — MEMORY ONLY. Never send this anywhere. */
  privateKey: Hex;
}

function getSubtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new KeystoreError('DECRYPT_FAILED', 'WebCrypto is unavailable in this environment.');
  }
  return c.subtle;
}

function toHexNoPrefix(bytes: Uint8Array): string {
  return bytesToHex(bytes).slice(2);
}

function fromHexNoPrefix(value: string): Uint8Array {
  return hexToBytes(`0x${value}` as Hex);
}

/**
 * Generate a fresh keypair in the browser (viem `generatePrivateKey` →
 * `privateKeyToAccount`). The private key is returned to the caller's memory and
 * MUST NOT be persisted or transmitted — only its encrypted keystore may be.
 */
export function generateKeypair(): GeneratedKeypair {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { address: account.address, privateKey };
}

/** Derive 32 raw key bytes from a passphrase + salt via PBKDF2-SHA-512. */
async function deriveDkBytes(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  const subtle = getSubtle();
  const material = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    material,
    DK_LEN * 8,
  );
  return new Uint8Array(bits);
}

/** Import the derived bytes as a non-extractable AES-256-GCM key. */
async function importAesKey(dkBytes: Uint8Array): Promise<CryptoKey> {
  return getSubtle().importKey('raw', dkBytes as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * v3-style integrity mac = keccak256(dk[16:32] || ciphertext). A wrong passphrase
 * yields a different derived key and thus a mismatching mac — so decryption fails
 * cheaply and cleanly BEFORE the AES step, exactly as Web3 Secret Storage v3
 * intends (GCM's own auth tag is a second, independent check).
 */
function computeMac(dkBytes: Uint8Array, ciphertext: Uint8Array): string {
  const macKey = dkBytes.subarray(16, 32);
  const joined = new Uint8Array(macKey.length + ciphertext.length);
  joined.set(macKey, 0);
  joined.set(ciphertext, macKey.length);
  return keccak256(joined).slice(2);
}

/**
 * Encrypt a private key into a Web3-Secret-Storage-v3-shaped JSON keystore.
 * Per-key random salt + IV; AES-256-GCM. The plaintext key is encrypted in place
 * and never included in the output (unit-tested).
 */
export async function encryptKeystore(
  privateKey: Hex,
  passphrase: string,
): Promise<EncryptedKeystoreV3> {
  if (!passphrase) {
    throw new KeystoreError('INVALID_KEYSTORE', 'A passphrase is required.');
  }
  const subtle = getSubtle();
  const account = privateKeyToAccount(privateKey);

  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const dkBytes = await deriveDkBytes(passphrase, salt);
  const key = await importAesKey(dkBytes);

  const plaintext = hexToBytes(privateKey); // 32 raw key bytes
  const sealed = new Uint8Array(
    await subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, tagLength: TAG_BYTES * 8 },
      key,
      plaintext as BufferSource,
    ),
  );
  // WebCrypto appends the auth tag to the ciphertext; split it out for the v3 shape.
  const ciphertext = sealed.subarray(0, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);

  return {
    version: 3,
    id: globalThis.crypto.randomUUID(),
    address: account.address.slice(2).toLowerCase(),
    crypto: {
      cipher: 'aes-256-gcm',
      ciphertext: toHexNoPrefix(ciphertext),
      cipherparams: { iv: toHexNoPrefix(iv), tag: toHexNoPrefix(tag) },
      kdf: 'pbkdf2',
      kdfparams: {
        dklen: DK_LEN,
        salt: toHexNoPrefix(salt),
        c: PBKDF2_ITERATIONS,
        prf: 'hmac-sha512',
      },
      mac: computeMac(dkBytes, ciphertext),
    },
  };
}

/** A decrypted account: address + the in-memory private key for signing. */
export interface DecryptedKeypair {
  address: Address;
  /** 0x-prefixed private key — MEMORY ONLY. */
  privateKey: Hex;
}

/**
 * Decrypt a keystore blob back into an in-memory account. A wrong passphrase or a
 * tampered blob FAILS CLEANLY as a typed {@link KeystoreError} — never a raw
 * throw and never a leak of the attempted key.
 */
export async function decryptKeystore(
  blob: unknown,
  passphrase: string,
): Promise<DecryptedKeypair> {
  const parsed = keystoreV3Schema.safeParse(blob);
  if (!parsed.success) {
    throw new KeystoreError('INVALID_KEYSTORE', 'Not a valid v3 keystore.');
  }
  const ks = parsed.data;

  try {
    const subtle = getSubtle();
    const salt = fromHexNoPrefix(ks.crypto.kdfparams.salt);
    const iv = fromHexNoPrefix(ks.crypto.cipherparams.iv);
    const tag = fromHexNoPrefix(ks.crypto.cipherparams.tag);
    const ciphertext = fromHexNoPrefix(ks.crypto.ciphertext);

    const dkBytes = await deriveDkBytes(passphrase, salt);

    // Verify the integrity mac before touching the ciphertext (clean early fail
    // on a wrong passphrase — its derived key produces a different mac).
    if (computeMac(dkBytes, ciphertext) !== ks.crypto.mac) {
      throw new KeystoreError('DECRYPT_FAILED', 'Incorrect passphrase or corrupted keystore.');
    }

    const key = await importAesKey(dkBytes);
    const sealed = new Uint8Array(ciphertext.length + tag.length);
    sealed.set(ciphertext, 0);
    sealed.set(tag, ciphertext.length);

    const plaintext = new Uint8Array(
      await subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource, tagLength: TAG_BYTES * 8 },
        key,
        sealed as BufferSource,
      ),
    );

    const privateKey = bytesToHex(plaintext);
    const account = privateKeyToAccount(privateKey);
    return { address: account.address, privateKey };
  } catch (err) {
    if (err instanceof KeystoreError) throw err;
    // GCM tag mismatch (wrong passphrase / tamper) and any other failure collapse
    // into one generic typed error — the raw cause never propagates.
    throw new KeystoreError('DECRYPT_FAILED', 'Incorrect passphrase or corrupted keystore.');
  }
}

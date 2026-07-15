// At-rest encryption helper (AGENT.md §5, SPEC §5/§13).
//
// SERVER-ONLY. This module reads the `ENCRYPTION_KEY` master secret from the
// validated env and must never be imported into a client bundle. It provides
// authenticated AES-256-GCM encryption for secrets stored in Postgres — namely
// `Network.rpcUrl` credentials and any persisted keystore blobs — so a database
// dump alone never yields plaintext credentials.
//
// This is NOT for user private keys / mnemonics: those are generated and
// encrypted only in the browser (AGENT.md §0, §6) and never reach the server in
// plaintext. This helper protects OPERATOR-side at-rest secrets only.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { getEnv } from '@nexus/config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const TAG_BYTES = 16; // 128-bit auth tag
const KEY_BYTES = 32; // AES-256
const VERSION = 'v1'; // envelope version prefix for forward compatibility
// Fixed, non-secret domain separator used only when we must derive a 32-byte key
// from a non-raw ENCRYPTION_KEY (e.g. a passphrase-style value).
const KDF_SALT = 'evm-nexus/at-rest/v1';

function tryDecode(value: string, encoding: 'base64' | 'hex'): Buffer | undefined {
  try {
    const buf = Buffer.from(value, encoding);
    // Buffer.from is lenient; round-trip to reject values that were not really
    // valid in this encoding (so we don't silently truncate a passphrase).
    if (buf.toString(encoding).replace(/=+$/, '') !== value.replace(/=+$/, '')) return undefined;
    return buf;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the 32-byte AES key from `ENCRYPTION_KEY`.
 *
 * A real deployment supplies a 32-byte key as base64 (44 chars) or hex (64
 * chars) — used verbatim. Anything else (e.g. a plain passphrase) is stretched
 * to 32 bytes with scrypt so the helper still works in dev/CI without weakening
 * a properly-sized key.
 */
function resolveKey(): Buffer {
  const raw = getEnv().ENCRYPTION_KEY;

  const asBase64 = tryDecode(raw, 'base64');
  if (asBase64?.length === KEY_BYTES) return asBase64;

  const asHex = tryDecode(raw, 'hex');
  if (asHex?.length === KEY_BYTES) return asHex;

  return scryptSync(raw, KDF_SALT, KEY_BYTES);
}

/**
 * Encrypt a UTF-8 plaintext for storage at rest. Returns a self-describing
 * envelope string `v1.<base64(iv | tag | ciphertext)>`.
 */
export function encryptAtRest(plaintext: string): string {
  const key = resolveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`;
}

/**
 * Decrypt an envelope produced by {@link encryptAtRest}. Throws if the version
 * is unknown, the payload is malformed, or the auth tag fails (tamper/wrong key).
 */
export function decryptAtRest(envelope: string): string {
  const [version, payload] = envelope.split('.', 2);
  if (version !== VERSION || !payload) {
    throw new Error('decryptAtRest: unrecognized or malformed ciphertext envelope');
  }

  const raw = Buffer.from(payload, 'base64');
  if (raw.length < IV_BYTES + TAG_BYTES) {
    throw new Error('decryptAtRest: ciphertext envelope is too short');
  }

  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, resolveKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

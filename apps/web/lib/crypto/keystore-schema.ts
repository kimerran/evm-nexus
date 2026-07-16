// Web3-Secret-Storage-v3-shaped keystore envelope (SPEC §4.1, AGENT.md §6).
//
// ISOMORPHIC + dependency-light: pure zod + types, no "use client" and no server
// imports, so it can be shared by the browser crypto module (which produces the
// envelope) and the server API (which only ever validates that a persisted blob
// IS a real ciphertext envelope — never a plaintext key). The envelope carries
// ONLY ciphertext + public KDF/cipher parameters; it never contains a plaintext
// private key, which is exactly why the server may store it without custody.
import { z } from 'zod';

/** Lowercase (or mixed) hex string with no `0x` prefix. */
const hex = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]+$/, 'Must be a hex string.')
  .min(1);

/**
 * The `crypto` sub-object: AES-256-GCM ciphertext + IV/tag, plus the PBKDF2-
 * SHA-512 KDF parameters used to stretch the passphrase. `mac` is a v3-style
 * integrity check computed over the derived key + ciphertext.
 */
export const keystoreCryptoSchema = z
  .object({
    cipher: z.literal('aes-256-gcm'),
    ciphertext: hex,
    cipherparams: z
      .object({
        iv: hex,
        tag: hex, // AES-GCM authentication tag (16 bytes → 32 hex chars)
      })
      .strict(),
    kdf: z.literal('pbkdf2'),
    kdfparams: z
      .object({
        dklen: z.literal(32),
        salt: hex,
        c: z.number().int().min(600_000), // ≥ 600k iterations (SPEC §4.1)
        prf: z.literal('hmac-sha512'),
      })
      .strict(),
    mac: hex,
  })
  .strict();

/**
 * The full keystore JSON. A payload missing `crypto.ciphertext` (a "raw"
 * keystore without a ciphertext envelope) fails this schema — so the API rejects
 * it with 400 rather than persisting anything that isn't opaque ciphertext.
 */
export const keystoreV3Schema = z
  .object({
    version: z.literal(3),
    id: z.string().min(1),
    // Public address, lowercase, no 0x prefix (v3 convention).
    address: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{40}$/, 'Must be a 20-byte hex address (no 0x).'),
    crypto: keystoreCryptoSchema,
  })
  .strict();

/** Encrypted keystore envelope (the opaque blob the server may persist). */
export type EncryptedKeystoreV3 = z.infer<typeof keystoreV3Schema>;

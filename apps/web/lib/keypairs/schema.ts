// Keypair API validation (SPEC §4.1, §8.3, AGENT.md §0/§6).
//
// SERVER-ONLY boundary validation. The server persists ONLY an opt-in, opaque
// encrypted keystore blob (label + public address + ciphertext envelope). It
// MUST reject any payload that carries private-key material. Two layers:
//
//   1. A recursive DENYLIST scan (`assertNoPrivateKeyMaterial`) that walks the
//      raw JSON and throws 400 if any key looks like a plaintext secret
//      (`privateKey`, `pk`, `mnemonic`, `seed`, …) — anywhere, at any depth.
//   2. `createKeypairSchema.strict()`, which additionally rejects ANY unknown
//      key and requires `encryptedKeystore` to be a real v3 ciphertext envelope
//      (a raw keystore missing the ciphertext fails, per §8.3).
import { z } from 'zod';
import { getAddress, isAddress } from 'viem';
import { keystoreV3Schema } from '@/lib/crypto/keystore-schema';
import { ValidationError } from '@/lib/errors';

/** Field names that would indicate a plaintext key/secret leaked into a payload. */
const FORBIDDEN_KEYS = new Set([
  'privatekey',
  'private_key',
  'pk',
  'mnemonic',
  'seed',
  'seedphrase',
  'seed_phrase',
  'secret',
  'secretkey',
  'secret_key',
  'keystorepassword',
  'passphrase',
]);

/**
 * Recursively assert that no object key in `value` is on the denylist. Throws a
 * {@link ValidationError} (→ 400) on the first match. This is the explicit,
 * defense-in-depth check the prime directive requires — even though `.strict()`
 * would also reject these as unknown keys at the top level, this catches them at
 * ANY depth (e.g. nested inside a forged keystore) with a clear message.
 */
export function assertNoPrivateKeyMaterial(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoPrivateKeyMaterial(item);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k.toLowerCase())) {
        throw new ValidationError('Payload must not contain private-key material.');
      }
      assertNoPrivateKeyMaterial(v);
    }
  }
}

/** Checksummed EVM address (rejects invalid; normalizes via viem getAddress). */
const evmAddress = z
  .string()
  .trim()
  .refine((v) => isAddress(v), { message: 'Invalid EVM address.' })
  .transform((v) => getAddress(v));

/**
 * POST /api/keypairs body: persist an opt-in encrypted keypair. `.strict()`
 * rejects unknown keys; `encryptedKeystore` must be a full v3 ciphertext envelope.
 */
export const createKeypairSchema = z
  .object({
    label: z.string().trim().min(1, 'Label is required.').max(80),
    address: evmAddress,
    encryptedKeystore: keystoreV3Schema,
  })
  .strict()
  .superRefine((data, ctx) => {
    // The keystore's embedded address must match the declared public address, so
    // the label/address the server indexes always describes the stored blob.
    if (data.encryptedKeystore.address.toLowerCase() !== data.address.slice(2).toLowerCase()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Keystore address does not match the declared address.',
        path: ['encryptedKeystore', 'address'],
      });
    }
  });

export type CreateKeypairInput = z.infer<typeof createKeypairSchema>;

/** POST /api/keypairs/validate-address body. */
export const validateAddressSchema = z.object({ address: z.string().trim().min(1).max(64) }).strict();

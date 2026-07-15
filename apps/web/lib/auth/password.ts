// Argon2id password hashing (SPEC §12, AGENT.md §5).
//
// SERVER-ONLY. Wraps `@node-rs/argon2` with a single, OWASP-aligned parameter
// set so every hash/verify in the app uses identical cost settings. The same
// parameters are used by the seed (prisma/seed.ts) so seeded and runtime hashes
// are interchangeable. Never log or return a plaintext password or a hash.
import { hash, verify } from '@node-rs/argon2';
import type { Options } from '@node-rs/argon2';

// @node-rs/argon2 ships `Algorithm` as a `const enum`, which can't be imported
// as a runtime value under `verbatimModuleSyntax`. Argon2id is member `2`; we
// use the literal (type-checked against the `Options.algorithm` field) to stay
// explicit without the const-enum import.
const ALGORITHM_ARGON2ID = 2 satisfies Options['algorithm'];

/**
 * Argon2id cost parameters (OWASP "second recommended" baseline; AGENT.md §5):
 * 19 MiB memory, 2 iterations, single lane. Tuned to be expensive for an
 * attacker while staying well under a request budget on server hardware.
 */
const ARGON2_OPTIONS: Options = {
  algorithm: ALGORITHM_ARGON2ID,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

/**
 * A real, throwaway argon2id digest used ONLY to equalize login timing when the
 * username does not exist: the handler verifies against this instead of
 * skipping the (deliberately slow) hash, so "unknown user" and "wrong password"
 * take the same time and cannot be distinguished (no user enumeration). Its
 * plaintext is not secret and matches nothing.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$Dhrw2YE73RuJTpyE5Z2Z2Q$TcRrSUs197obMPUMelui5PrGGYlSHgEYhwMiu3AHbBI';

/** Hash a plaintext password. Returns the encoded argon2id digest (with salt). */
export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTIONS);
}

/**
 * Verify a plaintext password against a stored argon2id digest. The salt and
 * cost parameters are encoded in the digest, so no options are needed here.
 * Returns `false` (never throws) on mismatch or a malformed/foreign digest, so
 * callers get a uniform boolean for the generic "invalid credentials" path.
 */
export async function verifyPassword(digest: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(digest, plaintext);
  } catch {
    return false;
  }
}

// Signed, time-limited URL tokens for the VOLUME driver (AGENT.md §5).
//
// SERVER-ONLY. The S3 driver gets expiring capability URLs for free (SigV4); the
// fs-backed volume driver mints the equivalent here — an HMAC over key + expiry +
// mode so a `/api/files/<key>` upload/download link cannot be forged or replayed
// after it expires. Same server secret as the draft tokens; no secret in the URL.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv } from '@nexus/config/env';

export type StorageTokenMode = 'get' | 'put';

function sign(key: string, exp: number, mode: StorageTokenMode): string {
  return createHmac('sha256', getEnv().SESSION_SECRET)
    .update(`${mode}:${key}:${exp}`)
    .digest('base64url');
}

/** Mint a signed token for `key` valid until `exp` (epoch ms) for `mode`. */
export function mintStorageToken(key: string, exp: number, mode: StorageTokenMode): string {
  return sign(key, exp, mode);
}

/** Verify a storage token against key/exp/mode. Rejects a bad sig or expiry. */
export function verifyStorageToken(
  key: string,
  exp: number,
  mode: StorageTokenMode,
  token: string,
  now: number = Date.now(),
): boolean {
  if (!Number.isFinite(exp) || exp < now) return false;
  const expected = sign(key, exp, mode);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

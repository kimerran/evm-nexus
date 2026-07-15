// RPC URL secret handling (SPEC §5/§8.2, AGENT.md §5 chain-safety & secrets).
//
// SERVER-ONLY. An RPC endpoint can carry a credential in two shapes:
//   1. userinfo — `https://user:key@host/…`
//   2. a key baked into the path/query — `https://svc/v2/<APIKEY>`
// We cannot reliably tell (2) apart from a public path, so the persistence rule
// is conservative: if the URL has userinfo we ENCRYPT the whole value at rest
// (lib/crypto/at-rest, AES-256-GCM); otherwise it is stored verbatim. On the way
// OUT to any client we NEVER return the stored value — only a redacted origin
// (`protocol//host[:port]`), which drops userinfo, path and query, so a
// path-embedded key can never leak either.
import { encryptAtRest, decryptAtRest } from '@/lib/crypto/at-rest';

/** Marker prefixing an at-rest-encrypted RPC URL so we can detect it on read. */
const ENC_PREFIX = 'enc:';

/** True when the URL embeds a credential in its userinfo (`user[:pass]@host`). */
export function hasUrlCredential(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.username !== '' || parsed.password !== '';
  } catch {
    // Not parseable as a URL — treat as non-credentialed; zod validation upstream
    // rejects malformed URLs before this is ever persisted.
    return false;
  }
}

/**
 * Prepare an RPC URL for storage: encrypt (and mark) it when it carries a
 * userinfo credential, otherwise store the plaintext URL verbatim.
 */
export function encodeRpcUrlForStorage(url: string): string {
  return hasUrlCredential(url) ? `${ENC_PREFIX}${encryptAtRest(url)}` : url;
}

/** True when a stored value is an encrypted RPC URL envelope. */
export function isEncodedRpcUrl(stored: string): boolean {
  return stored.startsWith(ENC_PREFIX);
}

/**
 * Recover the usable RPC URL from a stored value (decrypting when marked).
 * SERVER-ONLY — the plaintext must never cross to a client bundle/response.
 */
export function decodeRpcUrlFromStorage(stored: string): string {
  return isEncodedRpcUrl(stored) ? decryptAtRest(stored.slice(ENC_PREFIX.length)) : stored;
}

/**
 * Redact an RPC URL for client display: keep only `protocol//host[:port]`,
 * discarding userinfo, path, query and fragment (any of which can hold a
 * secret). Returns `null` for an unparseable value rather than echoing it.
 */
export function redactRpcUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

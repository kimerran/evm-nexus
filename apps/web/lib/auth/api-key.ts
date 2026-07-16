// Personal API-key auth path (SPEC §8.11, §12).
//
// SERVER-ONLY. Scripting clients authenticate with `Authorization: Bearer nxs_…`
// instead of the session cookie. The raw key is shown ONCE at issue time (issue
// #6 builds that UI); the server stores only `sha256(rawToken)` — never the raw
// key — so a database dump cannot recover or mint a usable key. Lookup is O(1)
// on the unique `keyHash`. Scope = the issuing user's live role.
//
// This module is deliberately small and reusable: format/hash/generate/parse are
// pure; `verifyApiKey` is the single DB-backed validation entry point.
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import type { Role } from './role';

/** Every key starts with this human-recognizable prefix. */
export const API_KEY_PREFIX = 'nxs_';
/** Chars of the token kept for display (`nxs_` + 8) — safe to store/show. */
const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 8;

/** A resolved API-key principal (mirrors the session user surface). */
export interface ApiKeyPrincipal {
  id: string;
  username: string;
  role: Role;
}

/** sha256 hex of a raw token — the only representation persisted. */
export function hashApiKey(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export interface GeneratedApiKey {
  /** The raw key — returned to the caller ONCE, never stored. */
  token: string;
  /** sha256(token) — stored in `ApiKey.keyHash`. */
  keyHash: string;
  /** Display prefix — stored in `ApiKey.prefix`. */
  prefix: string;
}

/** Mint a new API key: `nxs_` + 256 bits base64url. Returns raw + hash + prefix. */
export function generateApiKey(): GeneratedApiKey {
  const token = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, keyHash: hashApiKey(token), prefix: token.slice(0, DISPLAY_PREFIX_LENGTH) };
}

/**
 * Extract a raw API key from an `Authorization` header value. Returns the token
 * only when it is a well-formed `Bearer nxs_…`, else `null` (so a session-cookie
 * request or a malformed header falls through cleanly).
 */
export function parseApiKeyFromHeader(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
  const token = match?.[1];
  if (!token || !token.startsWith(API_KEY_PREFIX)) return null;
  return token;
}

/**
 * Validate a raw API key against the DB: the key must exist, not be revoked, not
 * be expired, and belong to an active user. On success returns the principal
 * (id/username/role) and best-effort stamps `lastUsedAt`. Any failure → `null`
 * (callers treat `null` as "no API-key auth").
 */
export async function verifyApiKey(rawToken: string): Promise<ApiKeyPrincipal | null> {
  if (!rawToken.startsWith(API_KEY_PREFIX)) return null;

  const record = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(rawToken) },
    include: { user: true },
  });
  if (!record) return null;
  if (record.revokedAt !== null) return null;
  if (record.expiresAt !== null && record.expiresAt.getTime() <= Date.now()) return null;
  if (!record.user.isActive) return null;

  // Best-effort usage stamp; never block auth on this write.
  try {
    await prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } });
  } catch {
    // ignore
  }

  return { id: record.user.id, username: record.user.username, role: record.user.role };
}

// Login rate limiter — Redis-backed, per-IP + per-username (SPEC §12, AGENT.md §5).
//
// SERVER-ONLY. A small, SELF-CONTAINED fixed-window failure counter for the
// login endpoint only. It counts FAILED attempts so a legitimate successful
// login never burns quota, and blocks once either the per-IP or the
// per-username failure count exceeds its window limit. Errors are generic and
// carry no user-enumeration signal (a blocked known user and a blocked unknown
// user look identical to the caller).
//
// TODO(#5): issue #5 generalizes rate limiting into a reusable limiter (faucet,
// bombard, chat, paymaster, per-route configs). This module is intentionally
// scoped to auth and should be REPLACED by / folded into that limiter — do not
// grow it into the general-purpose one here.
import Redis from 'ioredis';
import { getEnv } from '@nexus/config/env';

const WINDOW_SECONDS = 60;
const MAX_FAILURES_PER_USERNAME = 5;
const MAX_FAILURES_PER_IP = 20;
const KEY_PREFIX = 'auth:login:fail';

const globalForRedis = globalThis as unknown as { authRedis?: Redis };

function getRedis(): Redis {
  globalForRedis.authRedis ??= new Redis(getEnv().REDIS_URL, {
    // Keep login snappy and resilient: a slow/absent Redis must not hang the
    // request. On persistent failure we fail OPEN (see checkLoginRateLimit).
    maxRetriesPerRequest: 1,
    lazyConnect: false,
  });
  return globalForRedis.authRedis;
}

// Normalize the username into the key so case variations can't multiply the
// allowance. (DB usernames are unique; this only affects the counter key.)
function usernameKey(username: string): string {
  return `${KEY_PREFIX}:user:${username.trim().toLowerCase()}`;
}
function ipKey(ip: string): string {
  return `${KEY_PREFIX}:ip:${ip}`;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the block clears (only meaningful when `allowed` is false). */
  retryAfterSec: number;
}

/**
 * Decide whether a login attempt from `ip` for `username` may proceed. Reads the
 * current failure counters WITHOUT incrementing (increment happens only on an
 * actual failure via {@link registerFailedLogin}). Fails OPEN on Redis errors so
 * a Redis outage degrades brute-force protection rather than locking everyone
 * out — the trade-off documented in AGENT.md §5.
 */
export async function checkLoginRateLimit(ip: string, username: string): Promise<RateLimitDecision> {
  try {
    const redis = getRedis();
    const uKey = usernameKey(username);
    const iKey = ipKey(ip);
    const [uCountRaw, iCountRaw, uTtl, iTtl] = await Promise.all([
      redis.get(uKey),
      redis.get(iKey),
      redis.ttl(uKey),
      redis.ttl(iKey),
    ]);

    const uCount = Number(uCountRaw ?? 0);
    const iCount = Number(iCountRaw ?? 0);

    const userBlocked = uCount >= MAX_FAILURES_PER_USERNAME;
    const ipBlocked = iCount >= MAX_FAILURES_PER_IP;
    if (userBlocked || ipBlocked) {
      const ttls = [userBlocked ? uTtl : 0, ipBlocked ? iTtl : 0].filter((t) => t > 0);
      const retryAfterSec = ttls.length > 0 ? Math.max(...ttls) : WINDOW_SECONDS;
      return { allowed: false, retryAfterSec };
    }
    return { allowed: true, retryAfterSec: 0 };
  } catch {
    return { allowed: true, retryAfterSec: 0 };
  }
}

/**
 * Record a FAILED login attempt, incrementing both the per-username and per-IP
 * fixed-window counters and (re)arming their TTL on first use. Best-effort:
 * swallows Redis errors so a limiter outage never breaks the login path.
 */
export async function registerFailedLogin(ip: string, username: string): Promise<void> {
  try {
    const redis = getRedis();
    for (const key of [usernameKey(username), ipKey(ip)]) {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, WINDOW_SECONDS);
    }
  } catch {
    // best-effort; limiter must never break login
  }
}

/**
 * Clear the per-username counter after a SUCCESSFUL login so a user who mistyped
 * a few times then succeeded starts fresh. The per-IP counter is left intact
 * (shared NAT / attacker-behind-proxy must still decay on its own).
 */
export async function clearUsernameFailures(username: string): Promise<void> {
  try {
    await getRedis().del(usernameKey(username));
  } catch {
    // best-effort
  }
}

// Login rate limiter — thin adapter over the general limiter (SPEC §12, AGENT.md §5).
//
// SERVER-ONLY. Issue #5 generalized rate limiting into `@/lib/rate-limit`
// (Redis sliding window, keyable per user/IP/address). This module keeps the
// login-specific POLICY that predates it: count only FAILED attempts (a
// successful login never burns quota), block when either the per-username or
// per-IP failure window is exhausted, and stay generic — a blocked known user
// and a blocked unknown user are indistinguishable to the caller (no user
// enumeration). It now delegates all Redis work to the shared limiter.
import {
  RATE_LIMITS,
  peekRateLimit,
  rateLimitKey,
  recordRateLimitHit,
  resetRateLimit,
} from '@/lib/rate-limit';

// Normalize the username into the key so case variations can't multiply the
// allowance. (DB usernames are unique; this only affects the counter key.)
function usernameKey(username: string): string {
  return rateLimitKey('auth:login:user', username);
}
function ipKey(ip: string): string {
  return rateLimitKey('auth:login:ip', ip);
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
 * out.
 */
export async function checkLoginRateLimit(ip: string, username: string): Promise<RateLimitDecision> {
  const [user, byIp] = await Promise.all([
    peekRateLimit(usernameKey(username), RATE_LIMITS.loginPerUsername),
    peekRateLimit(ipKey(ip), RATE_LIMITS.loginPerIp),
  ]);
  if (!user.allowed || !byIp.allowed) {
    return { allowed: false, retryAfterSec: Math.max(user.retryAfterSec, byIp.retryAfterSec) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/**
 * Record a FAILED login attempt, incrementing both the per-username and per-IP
 * sliding-window counters. Best-effort: swallows Redis errors so a limiter
 * outage never breaks the login path.
 */
export async function registerFailedLogin(ip: string, username: string): Promise<void> {
  await Promise.all([
    recordRateLimitHit(usernameKey(username), RATE_LIMITS.loginPerUsername),
    recordRateLimitHit(ipKey(ip), RATE_LIMITS.loginPerIp),
  ]);
}

/**
 * Clear the per-username counter after a SUCCESSFUL login so a user who mistyped
 * a few times then succeeded starts fresh. The per-IP counter is left intact
 * (shared NAT / attacker-behind-proxy must still decay on its own).
 */
export async function clearUsernameFailures(username: string): Promise<void> {
  await resetRateLimit(usernameKey(username));
}

// Worker Redis connection + a minimal correct distributed lock (SPEC §9).
//
// BullMQ needs `maxRetriesPerRequest: null`. The same connection backs the
// per-address faucet lock that makes the cooldown/daily-cap check + broadcast
// atomic: SET NX PX to acquire, a compare-and-delete Lua script to release only
// our own token (never someone else's after a TTL expiry).
import { Redis } from 'ioredis';
import { getEnv } from './config';

let connection: Redis | undefined;

/** Shared ioredis connection for BullMQ + locks (one per worker process). */
export function getConnection(): Redis {
  connection ??= new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null });
  return connection;
}

// Release only if the stored token still matches ours (avoids releasing a lock a
// later holder acquired after our TTL lapsed).
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end`;

/**
 * Try to acquire `key` for `ttlMs`. Returns a unique token on success, or `null`
 * if another holder already owns it. Non-blocking (a single SET NX attempt).
 */
export async function acquireLock(key: string, ttlMs: number): Promise<string | null> {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await getConnection().set(key, token, 'PX', ttlMs, 'NX');
  return res === 'OK' ? token : null;
}

/** Release a lock iff we still hold it (compare-and-delete). */
export async function releaseLock(key: string, token: string): Promise<void> {
  await getConnection().eval(RELEASE_SCRIPT, 1, key, token);
}

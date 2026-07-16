// Shared ioredis client singleton (SPEC §4.3/§13, AGENT.md §5).
//
// SERVER-ONLY. One connection per process, stashed on globalThis so Next.js/HMR
// module reloads don't open a new connection on every edit. Consumers (the
// rate limiter, future faucet/bombard locks) share this instance. Kept resilient
// — a slow/absent Redis must degrade a feature (fail-open limiting), never hang
// the request — so `maxRetriesPerRequest` is capped low.
import Redis from 'ioredis';
import { getEnv } from '@nexus/config/env';

const globalForRedis = globalThis as unknown as { nexusRedis?: Redis };

export function getRedis(): Redis {
  globalForRedis.nexusRedis ??= new Redis(getEnv().REDIS_URL, {
    maxRetriesPerRequest: 1,
    lazyConnect: false,
  });
  return globalForRedis.nexusRedis;
}

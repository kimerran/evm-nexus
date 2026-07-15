// BullMQ Redis connection factory (SPEC §9, AGENT.md §2).
//
// SERVER-ONLY. BullMQ requires `maxRetriesPerRequest: null` on its ioredis
// connection (blocking commands must not be aborted), so it gets its OWN
// connection rather than the shared rate-limit client (which caps retries).
// One connection per process, stashed on globalThis so Next HMR reloads don't
// leak connections.
import { Redis } from 'ioredis';
import { getEnv } from '@nexus/config/env';

const globalForQueue = globalThis as unknown as { nexusQueueRedis?: Redis };

/** Shared ioredis connection tuned for BullMQ producers. */
export function getQueueConnection(): Redis {
  globalForQueue.nexusQueueRedis ??= new Redis(getEnv().REDIS_URL, {
    maxRetriesPerRequest: null,
  });
  return globalForQueue.nexusQueueRedis;
}

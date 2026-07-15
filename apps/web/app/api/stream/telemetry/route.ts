// GET /api/stream/telemetry — Server-Sent Events telemetry stream (SPEC §8.10).
//
// Authenticated. Streams live network health plus a tx feed, bombard progress
// and faucet events. Health is POLLED off the active-network RPC on an interval
// (the chain is the source of truth and has no push channel); the event feeds
// come from Redis PUB/SUB channels that later features publish onto — where no
// publisher exists yet the subscription simply stays quiet, and the health poll
// still guarantees a steady event stream.
//
// Lifecycle: the ReadableStream owns a poll timer, a heartbeat timer and a
// dedicated Redis subscriber connection. ALL are torn down when the client
// disconnects (the request's abort signal) so we never leak a timer or a Redis
// connection per dropped browser tab.
import type { NextRequest } from 'next/server';
import type { Redis } from 'ioredis';
import { requireAuth } from '@/lib/auth/require-role';
import { toErrorResponse } from '@/lib/http';
import { getRedis } from '@/lib/redis';
import { buildPublicClient, getActiveNetworkConfig } from '@/lib/chain/resolver';
import { readNetworkHealth } from '@/lib/chain/health';
import {
  TELEMETRY_CHANNELS,
  channelToEvent,
  formatSseEvent,
  sseComment,
} from '@/lib/telemetry/sse';

export const dynamic = 'force-dynamic';

const HEALTH_INTERVAL_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 15000;

export async function GET(req: NextRequest): Promise<Response> {
  try {
    await requireAuth(req);
  } catch (err) {
    return toErrorResponse(err);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let subscriber: Redis | null = null;
      let healthTimer: ReturnType<typeof setInterval> | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller already closed by a concurrent teardown — ignore.
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (healthTimer) clearInterval(healthTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (subscriber) {
          subscriber.disconnect();
          subscriber = null;
        }
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      // Client already gone before we started streaming.
      if (req.signal.aborted) {
        cleanup();
        return;
      }
      req.signal.addEventListener('abort', cleanup, { once: true });

      // Resolve the active network once and reuse the client for every poll.
      let client: ReturnType<typeof buildPublicClient> | null = null;
      try {
        client = buildPublicClient(await getActiveNetworkConfig());
      } catch {
        send(formatSseEvent('notice', { scope: 'network', message: 'No active network configured.' }));
      }

      const pushHealth = async () => {
        if (!client || closed) return;
        try {
          const health = await readNetworkHealth(client);
          send(formatSseEvent('health', health));
        } catch {
          send(formatSseEvent('notice', { scope: 'health', message: 'RPC unreachable.' }));
        }
      };

      // Announce, then emit an immediate first health frame so a client (or a
      // curl) sees a real event without waiting a full interval.
      send(formatSseEvent('ready', { at: new Date().toISOString() }));
      await pushHealth();

      healthTimer = setInterval(() => {
        void pushHealth();
      }, HEALTH_INTERVAL_MS);
      heartbeatTimer = setInterval(() => send(sseComment('hb')), HEARTBEAT_INTERVAL_MS);

      // Subscribe (best effort) to the event channels. A dedicated connection is
      // required — a subscriber cannot issue other commands. If Redis is down we
      // degrade to health-poll-only rather than failing the stream.
      try {
        const sub = getRedis().duplicate();
        sub.on('error', () => {
          // Swallow — the poll loop keeps the stream useful without pub/sub.
        });
        sub.on('message', (channel: string, message: string) => {
          const event = channelToEvent(channel);
          if (!event) return;
          let data: unknown = message;
          try {
            data = JSON.parse(message);
          } catch {
            // Non-JSON payload — forward the raw string.
          }
          send(formatSseEvent(event, data));
        });
        await sub.subscribe(...Object.values(TELEMETRY_CHANNELS));
        if (closed) {
          sub.disconnect();
        } else {
          subscriber = sub;
        }
      } catch {
        subscriber = null;
      }
    },
    cancel() {
      // Reader cancelled (e.g. client disconnect) — the abort listener runs the
      // full teardown; nothing extra needed here.
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable proxy buffering so events flush immediately.
      'X-Accel-Buffering': 'no',
    },
  });
}

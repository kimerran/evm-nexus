// Bombard telemetry publisher (SPEC §8.10). SERVER-ONLY (web app).
//
// Publishes a `bombard` progress event onto the Redis pub/sub channel that
// /api/stream/telemetry subscribes to, so the /lab Bombard panel's live counters
// update the instant a run is controlled (paused/cancelled) from the API side.
// The worker publishes its own progress events directly. Best-effort: a Redis
// error is swallowed — telemetry must never break the action it describes.
import { getRedis } from '@/lib/redis';
import { logger } from '@/lib/log';
import { TELEMETRY_CHANNELS } from '@/lib/telemetry/sse';
import type { BombardTelemetryEvent } from './bombard-event';

/** Publish one `bombard` event to the telemetry stream. Never throws. */
export async function publishBombardEvent(event: BombardTelemetryEvent): Promise<void> {
  try {
    await getRedis().publish(TELEMETRY_CHANNELS.bombard, JSON.stringify(event));
  } catch (err) {
    logger.warn({ err }, 'failed to publish bombard telemetry event');
  }
}

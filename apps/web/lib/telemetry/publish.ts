// Telemetry publisher (SPEC §8.10). SERVER-ONLY (web app).
//
// Publishes a `tx` event onto the Redis pub/sub channel that /api/stream/telemetry
// subscribes to, so the /lab live tx feed sees a transfer the instant it is
// broadcast (and again when the worker finalizes it). Best-effort: a Redis error
// is swallowed — telemetry must never break the broadcast it describes.
import { getRedis } from '@/lib/redis';
import { logger } from '@/lib/log';
import { TELEMETRY_CHANNELS } from './sse';
import type { TxTelemetryEvent } from './tx-event';

/** Publish one `tx` event to the telemetry stream. Never throws. */
export async function publishTxEvent(event: TxTelemetryEvent): Promise<void> {
  try {
    await getRedis().publish(TELEMETRY_CHANNELS.tx, JSON.stringify(event));
  } catch (err) {
    logger.warn({ err }, 'failed to publish tx telemetry event');
  }
}

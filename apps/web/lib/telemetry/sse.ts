// Telemetry stream primitives (SPEC §8.10).
//
// Shared, pure helpers for the SSE endpoint: the Redis pub/sub channel names
// that later features (tx feed, bombard runner, faucet drip) publish onto, the
// event-name mapping, and Server-Sent-Event frame serialization. Kept free of
// server-only imports so it can be unit tested directly.

/** Redis pub/sub channels the telemetry stream fans out to SSE clients. */
export const TELEMETRY_CHANNELS = {
  tx: 'nexus:telemetry:tx',
  bombard: 'nexus:telemetry:bombard',
  faucet: 'nexus:telemetry:faucet',
} as const;

/** Named SSE events emitted on the telemetry stream. */
export type TelemetryEventName = 'ready' | 'health' | 'tx' | 'bombard' | 'faucet' | 'notice';

/**
 * Serialize a Server-Sent Event frame: an optional `id`, an `event:` name and a
 * JSON `data:` payload, terminated by the blank line SSE requires. Data is
 * JSON-encoded so the browser can `JSON.parse` each event.
 */
export function formatSseEvent(event: TelemetryEventName, data: unknown, id?: string): string {
  const lines: string[] = [];
  if (id !== undefined) lines.push(`id: ${id}`);
  lines.push(`event: ${event}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  return `${lines.join('\n')}\n\n`;
}

/** A comment/heartbeat frame — keeps proxies from closing an idle connection. */
export function sseComment(text = ''): string {
  return `: ${text}\n\n`;
}

/** Map a subscribed Redis channel to its SSE event name, or null if unknown. */
export function channelToEvent(channel: string): TelemetryEventName | null {
  switch (channel) {
    case TELEMETRY_CHANNELS.tx:
      return 'tx';
    case TELEMETRY_CHANNELS.bombard:
      return 'bombard';
    case TELEMETRY_CHANNELS.faucet:
      return 'faucet';
    default:
      return null;
  }
}

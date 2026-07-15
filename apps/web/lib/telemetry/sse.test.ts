import { describe, expect, it } from 'vitest';
import {
  TELEMETRY_CHANNELS,
  channelToEvent,
  formatSseEvent,
  sseComment,
} from './sse';

describe('formatSseEvent', () => {
  it('serializes an event with a JSON data line and a trailing blank line', () => {
    const frame = formatSseEvent('health', { blockNumber: '10' });
    expect(frame).toBe('event: health\ndata: {"blockNumber":"10"}\n\n');
  });

  it('includes an id line when provided', () => {
    const frame = formatSseEvent('tx', { hash: '0xabc' }, '7');
    expect(frame).toBe('id: 7\nevent: tx\ndata: {"hash":"0xabc"}\n\n');
  });

  it('always terminates with the SSE blank-line delimiter', () => {
    expect(formatSseEvent('ready', {})).toMatch(/\n\n$/);
  });
});

describe('sseComment', () => {
  it('produces a comment/heartbeat frame', () => {
    expect(sseComment('hb')).toBe(': hb\n\n');
    expect(sseComment()).toBe(': \n\n');
  });
});

describe('channelToEvent', () => {
  it('maps known channels to their event names', () => {
    expect(channelToEvent(TELEMETRY_CHANNELS.tx)).toBe('tx');
    expect(channelToEvent(TELEMETRY_CHANNELS.bombard)).toBe('bombard');
    expect(channelToEvent(TELEMETRY_CHANNELS.faucet)).toBe('faucet');
  });

  it('returns null for an unknown channel', () => {
    expect(channelToEvent('nexus:telemetry:unknown')).toBeNull();
  });
});

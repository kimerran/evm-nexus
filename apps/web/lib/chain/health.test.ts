import { describe, expect, it } from 'vitest';
import {
  averageBlockTimeSeconds,
  parseHexCount,
  parseTxpoolStatus,
  safeRequest,
  type RawRpcRequest,
} from './health';

describe('averageBlockTimeSeconds (block-time derivation)', () => {
  it('returns null with fewer than two samples', () => {
    expect(averageBlockTimeSeconds([])).toBeNull();
    expect(averageBlockTimeSeconds([100n])).toBeNull();
  });

  it('derives the mean gap from evenly spaced timestamps', () => {
    // 5 blocks, 2s apart → mean 2s.
    expect(averageBlockTimeSeconds([100n, 102n, 104n, 106n, 108n])).toBe(2);
  });

  it('is order-independent (sorts before differencing)', () => {
    expect(averageBlockTimeSeconds([108n, 100n, 104n, 102n, 106n])).toBe(2);
  });

  it('averages uneven gaps across the full span', () => {
    // span 30 over 3 gaps → 10s mean.
    expect(averageBlockTimeSeconds([0n, 5n, 20n, 30n])).toBe(10);
  });

  it('returns null when all timestamps are equal (idle instamined chain)', () => {
    expect(averageBlockTimeSeconds([50n, 50n, 50n])).toBeNull();
  });

  it('keeps millisecond precision', () => {
    // span 5 over 2 gaps → 2.5s.
    expect(averageBlockTimeSeconds([0n, 2n, 5n])).toBe(2.5);
  });
});

describe('parseHexCount (net_peerCount parsing)', () => {
  it('parses a hex quantity', () => {
    expect(parseHexCount('0x2')).toBe(2);
    expect(parseHexCount('0x0')).toBe(0);
    expect(parseHexCount('0xff')).toBe(255);
  });

  it('returns null for unsupported / malformed responses', () => {
    expect(parseHexCount(null)).toBeNull();
    expect(parseHexCount(undefined)).toBeNull();
    expect(parseHexCount('')).toBeNull();
    expect(parseHexCount('not-hex')).toBeNull();
    expect(parseHexCount(42)).toBeNull();
    expect(parseHexCount({})).toBeNull();
  });

  it('clamps values beyond MAX_SAFE_INTEGER', () => {
    expect(parseHexCount('0xffffffffffffffffffff')).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('parseTxpoolStatus', () => {
  it('parses pending/queued hex counts', () => {
    expect(parseTxpoolStatus({ pending: '0x5', queued: '0x1' })).toEqual({ pending: 5, queued: 1 });
  });

  it('returns null when the method is unsupported (null) or shape is wrong', () => {
    expect(parseTxpoolStatus(null)).toBeNull();
    expect(parseTxpoolStatus('nope')).toBeNull();
    expect(parseTxpoolStatus({ pending: '0x5' })).toBeNull();
    expect(parseTxpoolStatus({ pending: 'x', queued: '0x1' })).toBeNull();
  });
});

describe('safeRequest (graceful missing-RPC-method handling)', () => {
  it('returns the raw result when the method is supported', async () => {
    const request: RawRpcRequest = async ({ method }) => (method === 'net_peerCount' ? '0x3' : null);
    await expect(safeRequest(request, 'net_peerCount')).resolves.toBe('0x3');
  });

  it('maps a "method not found" rejection to null (never throws)', async () => {
    const request: RawRpcRequest = async () => {
      throw new Error('the method txpool_status does not exist/is not available');
    };
    await expect(safeRequest(request, 'txpool_status')).resolves.toBeNull();
  });

  it('maps a transport error to null', async () => {
    const request: RawRpcRequest = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    await expect(safeRequest(request, 'net_peerCount')).resolves.toBeNull();
  });

  it('forwards params when provided', async () => {
    let seen: readonly unknown[] | undefined;
    const request: RawRpcRequest = async ({ params }) => {
      seen = params;
      return 'ok';
    };
    await safeRequest(request, 'eth_getBlockByNumber', ['0x1', false]);
    expect(seen).toEqual(['0x1', false]);
  });
});

// Shared network health reader (SPEC §8.2/§8.11, AGENT.md §4/§5).
//
// SERVER-ONLY. Given a viem public client (built by the resolver from an
// admin-approved network config — never a browser-supplied RPC URL), read live
// chain telemetry: chainId, latest block height, gas price, a derived block
// time, peer count and txpool status. Wei values are returned as decimal strings
// and block numbers as strings (AGENT.md §4 — never `Number()` a wei/height).
//
// Some RPCs (anvil, many managed providers) do not implement `net_peerCount` or
// `txpool_status`. Those calls are made through {@link safeRequest}, which maps a
// missing method / any error to `null` so a caller NEVER 500s on an unsupported
// method — it just reports the field as unavailable.
import type { PublicClient } from 'viem';

/** Pending/queued transaction counts from `txpool_status`. */
export interface TxpoolStatus {
  pending: number;
  queued: number;
}

/** Live chain telemetry for a single network. All money/heights are strings. */
export interface NetworkHealth {
  chainId: number;
  /** Latest block height (decimal string). */
  blockNumber: string;
  /** Current gas price in wei (decimal string). */
  gasPriceWei: string;
  /** Mean seconds between the sampled recent blocks, or null when underivable. */
  blockTimeSec: number | null;
  /** Connected peers via `net_peerCount`, or null when the RPC lacks it. */
  peerCount: number | null;
  /** Pending/queued txpool counts, or null when the RPC lacks `txpool_status`. */
  txpool: TxpoolStatus | null;
  /** How many block timestamps fed the block-time derivation. */
  sampledBlocks: number;
  online: true;
}

/**
 * Mean seconds between consecutive blocks, derived from a set of recent block
 * timestamps (any order). Returns `null` when there is too little signal to
 * derive it — fewer than two samples, or a non-positive span (e.g. an idle
 * instamined dev chain whose blocks share a timestamp). Kept pure so it is unit
 * testable without a chain.
 */
export function averageBlockTimeSeconds(timestamps: readonly bigint[]): number | null {
  if (timestamps.length < 2) return null;
  const sorted = [...timestamps].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return null;
  const span = last - first;
  const gaps = BigInt(sorted.length - 1);
  if (span <= 0n) return null;
  // ms precision, computed in the Number domain only after reducing to a small
  // seconds delta (safe — block-time gaps are tiny, never wei-scale).
  return Math.round((Number(span) / Number(gaps)) * 1000) / 1000;
}

/**
 * Parse a hex-quantity RPC result (e.g. `net_peerCount` → "0x2") to a number.
 * Returns `null` for anything that is not a valid hex/decimal quantity, so an
 * unsupported or malformed response degrades gracefully. Clamps absurd values to
 * `Number.MAX_SAFE_INTEGER` rather than losing precision silently.
 */
export function parseHexCount(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const n = BigInt(value);
    if (n < 0n) return null;
    return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : Number.MAX_SAFE_INTEGER;
  } catch {
    return null;
  }
}

/** Parse a `txpool_status` result (`{ pending, queued }` hex counts) or null. */
export function parseTxpoolStatus(value: unknown): TxpoolStatus | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const pending = parseHexCount(record.pending);
  const queued = parseHexCount(record.queued);
  if (pending === null || queued === null) return null;
  return { pending, queued };
}

/** A raw JSON-RPC request function (viem's `request`, loosened for extra methods). */
export type RawRpcRequest = (args: {
  method: string;
  params?: readonly unknown[];
}) => Promise<unknown>;

/**
 * Issue a raw RPC call, mapping ANY failure (method not found, transport error)
 * to `null`. This is how optional methods (`net_peerCount`, `txpool_status`)
 * stay non-fatal — a network that lacks them reports the field as unavailable
 * instead of failing the whole health read.
 */
export async function safeRequest(
  request: RawRpcRequest,
  method: string,
  params?: readonly unknown[],
): Promise<unknown> {
  try {
    return await request(params ? { method, params } : { method });
  } catch {
    return null;
  }
}

/** How many recent blocks to sample when deriving block time. */
const DEFAULT_BLOCK_SAMPLE = 6;

/**
 * Read live {@link NetworkHealth} from a viem public client. The three core
 * reads (chainId, latest block, gas price) are required — if the RPC is
 * unreachable this rejects, and the caller maps that to a 502. Optional methods
 * (peer count, txpool) never reject; they resolve to `null` when unsupported.
 */
export async function readNetworkHealth(
  client: PublicClient,
  options?: { blockSample?: number },
): Promise<NetworkHealth> {
  const blockSample = Math.max(2, options?.blockSample ?? DEFAULT_BLOCK_SAMPLE);
  // viem's typed `request` only knows standard schemas; loosen it (through
  // `unknown`, never `any`) so we can call node-specific optional methods.
  const request = client.request as unknown as RawRpcRequest;

  const [chainId, latest, gasPrice] = await Promise.all([
    client.getChainId(),
    client.getBlock({ blockTag: 'latest' }),
    client.getGasPrice(),
  ]);

  const latestNumber = latest.number ?? 0n;
  const timestamps: bigint[] = [latest.timestamp];
  const olderSpan =
    latestNumber > BigInt(blockSample - 1) ? blockSample - 1 : Number(latestNumber);
  if (olderSpan > 0) {
    const older = await Promise.all(
      Array.from({ length: olderSpan }, (_, i) =>
        client
          .getBlock({ blockNumber: latestNumber - BigInt(i + 1) })
          .then((block) => block.timestamp)
          .catch(() => null),
      ),
    );
    for (const ts of older) {
      if (ts !== null) timestamps.push(ts);
    }
  }

  const [peerRaw, txpoolRaw] = await Promise.all([
    safeRequest(request, 'net_peerCount'),
    safeRequest(request, 'txpool_status'),
  ]);

  return {
    chainId,
    blockNumber: latestNumber.toString(),
    gasPriceWei: gasPrice.toString(),
    blockTimeSec: averageBlockTimeSeconds(timestamps),
    peerCount: parseHexCount(peerRaw),
    txpool: parseTxpoolStatus(txpoolRaw),
    sampledBlocks: timestamps.length,
    online: true,
  };
}

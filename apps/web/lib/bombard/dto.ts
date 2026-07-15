// Serializable Bombard DTOs shared by the API + the /lab panel (SPEC §8.7).
//
// Counts stay numbers; everything else is a string/enum over the wire. Nothing
// secret is carried (no raw txs, no keys).
import type { BombardRun, BombardEvent } from '@/lib/generated/prisma/client';

/** A bombard run as returned to the client. */
export interface BombardRunView {
  id: string;
  networkId: string;
  mode: string;
  status: string;
  targetTps: number;
  totalCount: number;
  sentCount: number;
  successCount: number;
  failCount: number;
  fromAddress: string | null;
  toAddress: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

/** A single per-tx bombard event as returned to the client. */
export interface BombardEventView {
  id: string;
  txHash: string | null;
  nonce: number | null;
  status: string;
  latencyMs: number | null;
  createdAt: string;
}

/** Map a BombardRun row to its client view. */
export function toBombardRunView(row: BombardRun): BombardRunView {
  return {
    id: row.id,
    networkId: row.networkId,
    mode: row.mode,
    status: row.status,
    targetTps: row.targetTps,
    totalCount: row.totalCount,
    sentCount: row.sentCount,
    successCount: row.successCount,
    failCount: row.failCount,
    fromAddress: row.fromAddress,
    toAddress: row.toAddress,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Map a BombardEvent row to its client view. */
export function toBombardEventView(row: BombardEvent): BombardEventView {
  return {
    id: row.id,
    txHash: row.txHash,
    nonce: row.nonce,
    status: row.status,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt.toISOString(),
  };
}

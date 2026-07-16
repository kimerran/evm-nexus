// Shape of a `tx` telemetry event (SPEC §8.10). PURE + dependency-free so BOTH
// publishers — the web broadcast route AND the tx-watch worker — and the SSE
// consumer agree on one shape and it can never drift. Serialized as JSON onto the
// `nexus:telemetry:tx` Redis channel that /api/stream/telemetry fans out to /lab.
//
// Amounts stay decimal STRINGS (never floats). No secrets — only public tx
// metadata (ids, addresses, hashes, statuses).

/** A single transaction lifecycle event on the live tx feed. */
export interface TxTelemetryEvent {
  /** Transfer row id (or other tx-watch subject id). */
  id: string;
  /** Discriminates the on-chain kind — NATIVE / ERC20 / ERC721 / ERC1155. */
  kind: string;
  /** Lifecycle status (PENDING / CONFIRMING / SUCCESS / FAILED …). */
  status: string;
  fromAddress: string;
  toAddress: string;
  tokenAddress: string | null;
  tokenId: string | null;
  /** Transferred amount in wei/units (decimal string), or null. */
  amount: string | null;
  txHash: string | null;
  /** ISO timestamp the event was emitted. */
  at: string;
}

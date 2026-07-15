// Opaque, signed transfer DRAFT token (SPEC §8.6, AGENT.md §5).
//
// SERVER-ONLY. `/prepare` builds the unsigned transfer tx and hands the client an
// HMAC-signed draft that pins EVERY security-relevant value: the owning user, the
// target network + chainId, the transfer semantics (kind/from/to/token/tokenId/
// amount), the exact resolved tx (`txTo`, `txValue`, `data`) the user must sign,
// and a snapshot of the gas/value/fee ceilings. The client signs the tx and
// returns the draft verbatim; `/broadcast` verifies the HMAC, checks expiry +
// owner, then enforces that the SIGNED tx matches the pinned to/value/data/chainId
// and stays within the pinned ceilings BEFORE broadcasting. A tampered or forged
// draft fails the HMAC and is rejected. No secret material is in the payload.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv } from '@nexus/config/env';
import type { Hex } from 'viem';
import type { TransferRequest } from './schema';

/** Draft lifetime — long enough to decrypt a keystore + sign, short enough to bound replay. */
export const DRAFT_TTL_MS = 15 * 60 * 1000;

/** The pinned draft payload (all values are public metadata; no secrets). */
export interface TransferDraft {
  v: 1;
  userId: string;
  networkId: string;
  chainId: number;
  kind: TransferRequest['kind'];
  /** Sender (recovered signer must equal this). */
  from: string;
  /** Logical recipient (the asset destination; equals `txTo` only for native). */
  to: string;
  tokenAddress: string | null;
  tokenId: string | null;
  /** Transferred amount in wei/units (native value or token amount); null for ERC-721. */
  amount: string | null;
  /** The signed tx `to`: recipient (native) or token contract (asset). */
  txTo: string;
  /** The signed tx `value` in wei (decimal string). */
  txValue: string;
  /** The signed tx calldata (`0x` for native). */
  data: Hex;
  /** Ceiling snapshot (bigint serialized as decimal strings). */
  maxGas: string;
  maxValueWei: string;
  maxFeePerGasWei: string;
  /** Absolute expiry (epoch ms). */
  exp: number;
}

function secret(): string {
  // Reuse the session secret as the HMAC key — high-entropy, server-only, never
  // leaves the process. The draft is signed, not encrypted (no secrets in it).
  return getEnv().SESSION_SECRET;
}

function sign(payloadB64: string): string {
  return createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

/** Encode + sign a draft into an opaque `<payload>.<mac>` token. */
export function encodeDraft(draft: TransferDraft): string {
  const payloadB64 = Buffer.from(JSON.stringify(draft), 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** Failure reason from {@link decodeDraft}. */
export type DraftDecodeError = 'malformed' | 'bad-signature' | 'expired';

export type DraftDecodeResult =
  | { ok: true; draft: TransferDraft }
  | { ok: false; error: DraftDecodeError };

/** Verify + decode a draft token. Rejects a bad signature, malformed, or expired draft. */
export function decodeDraft(token: string, now: number = Date.now()): DraftDecodeResult {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return { ok: false, error: 'malformed' };
  const payloadB64 = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  const expected = sign(payloadB64);
  const macBuf = Buffer.from(mac);
  const expBuf = Buffer.from(expected);
  if (macBuf.length !== expBuf.length || !timingSafeEqual(macBuf, expBuf)) {
    return { ok: false, error: 'bad-signature' };
  }

  let draft: TransferDraft;
  try {
    draft = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as TransferDraft;
  } catch {
    return { ok: false, error: 'malformed' };
  }
  if (typeof draft.exp !== 'number' || draft.exp < now) {
    return { ok: false, error: 'expired' };
  }
  return { ok: true, draft };
}

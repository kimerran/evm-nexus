// Opaque, signed chat-commit DRAFT token (SPEC §8.8, AGENT.md §5).
//
// SERVER-ONLY. `POST /api/chat` builds the unsigned `ChatLog.commit` tx and hands
// the client an HMAC-signed draft pinning EVERY security-relevant value: the
// owning user, the target network + chainId, the ChatMessage id + contentHash,
// the signer (`from`), the exact resolved tx (`txTo` = ChatLog, `txValue` = 0,
// `data`), and the gas/fee ceiling snapshot. `/commit` verifies the HMAC, expiry,
// and owner, then enforces the SIGNED tx matches the pinned to/value/data/chainId
// within the ceilings BEFORE broadcasting. A tampered/forged draft fails the HMAC.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv } from '@nexus/config/env';
import type { Hex } from 'viem';

/** Draft lifetime — long enough to unlock a keystore + sign, short enough to bound replay. */
export const CHAT_DRAFT_TTL_MS = 15 * 60 * 1000;

export interface ChatCommitDraft {
  v: 1;
  userId: string;
  networkId: string;
  chainId: number;
  messageId: string;
  contentHash: Hex;
  /** Sender (recovered signer must equal this). */
  from: string;
  /** The signed tx `to`: the ChatLog contract. */
  txTo: string;
  /** The signed tx `value` in wei — always "0" (commit is non-payable). */
  txValue: string;
  /** The signed tx calldata (`commit(contentHash, ref)`). */
  data: Hex;
  maxGas: string;
  maxFeePerGasWei: string;
  exp: number;
}

function secret(): string {
  return getEnv().SESSION_SECRET;
}

function sign(payloadB64: string): string {
  return createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

/** Encode + sign a draft into an opaque `<payload>.<mac>` token. */
export function encodeChatDraft(draft: ChatCommitDraft): string {
  const payloadB64 = Buffer.from(JSON.stringify(draft), 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

export type ChatDraftDecodeError = 'malformed' | 'bad-signature' | 'expired';

export type ChatDraftDecodeResult =
  | { ok: true; draft: ChatCommitDraft }
  | { ok: false; error: ChatDraftDecodeError };

/** Verify + decode a draft token. Rejects a bad signature, malformed, or expired draft. */
export function decodeChatDraft(token: string, now: number = Date.now()): ChatDraftDecodeResult {
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

  let draft: ChatCommitDraft;
  try {
    draft = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as ChatCommitDraft;
  } catch {
    return { ok: false, error: 'malformed' };
  }
  if (typeof draft.exp !== 'number' || draft.exp < now) {
    return { ok: false, error: 'expired' };
  }
  return { ok: true, draft };
}

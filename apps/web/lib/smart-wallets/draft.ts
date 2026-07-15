// Opaque, signed smart-account DEPLOY draft token (SPEC §8.9, AGENT.md §5).
//
// SERVER-ONLY. Mirrors the transfer/deploy draft: `/deploy` builds the unsigned
// factory `createAccount(owner,salt)` tx and hands the client an HMAC-signed draft
// pinning every security-relevant value — the owning user, network + chainId, the
// owner/account addresses, and the exact tx (`to` = factory, `data`, ceilings) the
// user must sign. `/deploy/broadcast` re-verifies the HMAC + owner, then checks the
// SIGNED tx matches the pinned to/value/data/chainId within ceilings BEFORE
// broadcasting. No secret material is in the payload (it is signed, not encrypted).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv } from '@nexus/config/env';
import type { Hex } from 'viem';

/** Draft lifetime — long enough to decrypt a keystore + sign, short enough to bound replay. */
export const DEPLOY_DRAFT_TTL_MS = 15 * 60 * 1000;

/** The pinned deploy-draft payload (all values are public metadata; no secrets). */
export interface DeployDraft {
  v: 1;
  userId: string;
  networkId: string;
  chainId: number;
  ownerAddress: string;
  accountAddress: string;
  factory: string;
  salt: string;
  /** The signed tx `to` (the factory) and calldata (createAccount). */
  txTo: string;
  data: Hex;
  /** Ceiling snapshot (decimal strings). */
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

/** Encode + sign a deploy draft into an opaque `<payload>.<mac>` token. */
export function encodeDeployDraft(draft: DeployDraft): string {
  const payloadB64 = Buffer.from(JSON.stringify(draft), 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

export type DeployDraftDecodeError = 'malformed' | 'bad-signature' | 'expired';
export type DeployDraftDecodeResult =
  | { ok: true; draft: DeployDraft }
  | { ok: false; error: DeployDraftDecodeError };

/** Verify + decode a deploy draft token. Rejects a bad signature, malformed, or expired draft. */
export function decodeDeployDraft(token: string, now: number = Date.now()): DeployDraftDecodeResult {
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

  let draft: DeployDraft;
  try {
    draft = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as DeployDraft;
  } catch {
    return { ok: false, error: 'malformed' };
  }
  if (typeof draft.exp !== 'number' || draft.exp < now) {
    return { ok: false, error: 'expired' };
  }
  return { ok: true, draft };
}

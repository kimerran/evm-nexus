// Opaque, signed deployment DRAFT token (SPEC §8.5, AGENT.md §5).
//
// SERVER-ONLY. `/estimate` builds the unsigned deploy tx and hands the client an
// HMAC-signed draft that pins EVERY security-relevant value: the owning user, the
// target network + chainId, the exact contract-creation `data` (bytecode + ctor
// args), the deployer address, and a snapshot of the gas/value/fee ceilings. The
// client signs the tx and returns the draft verbatim; `/broadcast` verifies the
// HMAC, checks expiry + owner, then enforces that the SIGNED tx matches the pinned
// data/chainId and stays within the pinned ceilings BEFORE broadcasting. A tampered
// or forged draft fails the HMAC and is rejected. No secret material is in the
// payload — only public metadata a client already supplied.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv } from '@nexus/config/env';
import type { Hex } from 'viem';
import type { DeployRequest } from './schema';
import type { ContractName } from './artifacts';

/** Draft lifetime — long enough to decrypt a keystore + sign, short enough to bound replay. */
export const DRAFT_TTL_MS = 15 * 60 * 1000;

/** The pinned draft payload (all values are public metadata; no secrets). */
export interface DeployDraft {
  v: 1;
  userId: string;
  networkId: string;
  chainId: number;
  standard: DeployRequest['standard'];
  contractName: ContractName;
  ownerAddress: string;
  name: string;
  symbol: string | null;
  initialSupply: string | null;
  baseUri: string | null;
  features: Record<string, boolean>;
  /** bytecode + ABI-encoded ctor args — the tx `data` the client MUST sign. */
  data: Hex;
  /** Ceiling snapshot (bigint serialized as decimal strings). */
  maxGas: string;
  maxValueWei: string;
  maxFeePerGasWei: string;
  /** Absolute expiry (epoch ms). */
  exp: number;
}

function secret(): string {
  // Reuse the session secret as the HMAC key — it is high-entropy, server-only,
  // and never leaves the process. The draft is signed, not encrypted (it carries
  // no secrets), so integrity is all we need.
  return getEnv().SESSION_SECRET;
}

function sign(payloadB64: string): string {
  return createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

/** Encode + sign a draft into an opaque `<payload>.<mac>` token. */
export function encodeDraft(draft: DeployDraft): string {
  const payloadB64 = Buffer.from(JSON.stringify(draft), 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** Failure reason from {@link decodeDraft}. */
export type DraftDecodeError = 'malformed' | 'bad-signature' | 'expired';

export type DraftDecodeResult =
  | { ok: true; draft: DeployDraft }
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

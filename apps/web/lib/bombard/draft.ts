// Opaque, signed bombard PLAN token (SPEC §8.7, AGENT.md §5). SERVER-ONLY.
//
// `/prepare` validates ceilings, creates the QUEUED run, and hands the client an
// HMAC-signed plan that pins EVERY execution parameter: the owning user + run,
// the target network + chainId, the mode, the sender/recipient, the exact per-tx
// value/gas/fees, and the assigned nonce range. The client bulk-signs the txs and
// returns the plan verbatim; `/start` verifies the HMAC + owner + run + expiry,
// then trusts the pinned plan (persists it for the worker) rather than any value
// the client could otherwise forge at start time. No secret material is in the
// payload — it is signed, not encrypted.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv } from '@nexus/config/env';

/** Plan lifetime — long enough to bulk-decrypt + sign N txs, short enough to bound replay. */
export const BOMBARD_PLAN_TTL_MS = 30 * 60 * 1000;

/** The pinned plan payload (all values are public metadata; no secrets). */
export interface BombardPlan {
  v: 1;
  userId: string;
  runId: string;
  networkId: string;
  chainId: number;
  mode: 'CLIENT_SIGNED' | 'RELAYER';
  /** Sender (recovered signer of each client-signed tx must equal this). */
  from: string;
  /** Recipient of every bombard native transfer. */
  to: string;
  /** Native value moved by each tx, in wei (decimal string). */
  amountPerTxWei: string;
  /** First nonce of the assigned contiguous range; tx i uses `startNonce + i`. */
  startNonce: number;
  /** Number of txs in the run (= the run's totalCount). */
  totalCount: number;
  /** Target TPS the runner paces to. */
  targetTps: number;
  /** Per-tx gas limit (decimal string). */
  gas: string;
  /** Per-tx EIP-1559 fees (decimal strings). */
  maxFeePerGasWei: string;
  maxPriorityFeePerGasWei: string;
  /** Absolute expiry (epoch ms). */
  exp: number;
}

function secret(): string {
  // Reuse the session secret as the HMAC key — high-entropy, server-only, never
  // leaves the process. The plan is signed, not encrypted (no secrets in it).
  return getEnv().SESSION_SECRET;
}

function sign(payloadB64: string): string {
  return createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

/** Encode + sign a plan into an opaque `<payload>.<mac>` token. */
export function encodePlan(plan: BombardPlan): string {
  const payloadB64 = Buffer.from(JSON.stringify(plan), 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

export type PlanDecodeError = 'malformed' | 'bad-signature' | 'expired';

export type PlanDecodeResult =
  | { ok: true; plan: BombardPlan }
  | { ok: false; error: PlanDecodeError };

/** Verify + decode a plan token. Rejects a bad signature, malformed, or expired plan. */
export function decodePlan(token: string, now: number = Date.now()): PlanDecodeResult {
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

  let plan: BombardPlan;
  try {
    plan = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as BombardPlan;
  } catch {
    return { ok: false, error: 'malformed' };
  }
  if (typeof plan.exp !== 'number' || plan.exp < now) {
    return { ok: false, error: 'expired' };
  }
  return { ok: true, plan };
}

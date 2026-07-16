// Chain-safety verification for a client-signed transfer tx (AGENT.md §5, SPEC §8.6).
//
// SERVER-ONLY but dependency-light (viem + typed errors). The server NEVER sees a
// private key — only a raw SIGNED tx — so before broadcasting it must independently
// prove the signature covers exactly what we authorized:
//
//   1. Its `chainId` equals BOTH the pinned draft chainId AND the live active
//      network chainId (checked by the caller against the live client too).
//   2. Its `to` equals the draft's pinned `txTo` (recipient for native, the token
//      contract for an asset) — no redirected recipient / swapped token.
//   3. Its `value` equals the draft's pinned `txValue` EXACTLY — no inflated
//      native amount (0 for a token transfer).
//   4. Its `data` equals the draft's pinned calldata (the exact transfer args).
//   5. `gas`, `value`, and `maxFeePerGas`/`gasPrice` are within the pinned ceilings.
//   6. The recovered signer equals the draft's `from` (the sender).
//
// Any breach throws a ValidationError (→ 400) and the tx is NOT broadcast.
import { parseTransaction, recoverTransactionAddress, getAddress } from 'viem';
import type { Hex } from 'viem';
import { ValidationError } from '@/lib/errors';
import type { TransferDraft } from './draft';
import type { TransferCeilings } from './ceilings';

/** Normalized view of a parsed signed transfer tx (bigint amounts in memory). */
export interface ParsedSignedTransfer {
  chainId: number;
  /** `null` only for a contract creation — never valid for a transfer. */
  to: string | null;
  value: bigint;
  gas: bigint;
  /** Effective max fee (maxFeePerGas for 1559, else gasPrice). */
  maxFeePerGas: bigint;
  data: Hex;
  /** Recovered signer (checksummed). */
  from: string;
}

/** Parse + recover a raw signed tx into a normalized transfer view. */
export async function parseSignedTransfer(rawSignedTx: string): Promise<ParsedSignedTransfer> {
  const serialized = rawSignedTx as Hex;
  let tx;
  try {
    tx = parseTransaction(serialized);
  } catch {
    throw new ValidationError('rawSignedTx is not a valid transaction.');
  }

  type RecoverArg = Parameters<typeof recoverTransactionAddress>[0]['serializedTransaction'];
  const from = await recoverTransactionAddress({
    serializedTransaction: serialized as RecoverArg,
  }).catch(() => {
    throw new ValidationError('rawSignedTx signature could not be recovered.');
  });

  const maxFeePerGas = tx.maxFeePerGas ?? tx.gasPrice ?? 0n;
  return {
    chainId: typeof tx.chainId === 'number' ? tx.chainId : Number(tx.chainId ?? 0),
    to: tx.to ? getAddress(tx.to) : null,
    value: tx.value ?? 0n,
    gas: tx.gas ?? 0n,
    maxFeePerGas,
    data: (tx.data ?? '0x') as Hex,
    from: getAddress(from),
  };
}

export interface TransferPolicyContext {
  draft: TransferDraft;
  /** The live active-network chainId (read from the resolver's client). */
  activeChainId: number;
  ceilings: TransferCeilings;
}

/**
 * Enforce every chain-safety invariant against a parsed signed transfer. Throws a
 * {@link ValidationError} on the first breach; returns cleanly when allowed.
 */
export function assertTransferWithinPolicy(
  parsed: ParsedSignedTransfer,
  { draft, activeChainId, ceilings }: TransferPolicyContext,
): void {
  if (!ceilings.enabled) {
    throw new ValidationError('Transfers are currently disabled.');
  }
  if (parsed.to === null) {
    throw new ValidationError('Signed tx must have a `to` (a transfer is never a contract creation).');
  }
  // chainId must match the pinned draft AND the live active network.
  if (parsed.chainId !== draft.chainId || parsed.chainId !== activeChainId) {
    throw new ValidationError(
      `chainId mismatch: signed ${parsed.chainId} != active ${activeChainId}.`,
    );
  }
  // The signed `to` must equal exactly what /prepare pinned (recipient or token).
  if (getAddress(parsed.to) !== getAddress(draft.txTo)) {
    throw new ValidationError('Signed tx `to` does not match the authorized transfer target.');
  }
  // The signed value must equal the pinned value EXACTLY (0 for token transfers).
  if (parsed.value !== BigInt(draft.txValue)) {
    throw new ValidationError('Signed tx value does not match the authorized transfer amount.');
  }
  // The signed calldata must equal exactly what /prepare authorized.
  if (parsed.data.toLowerCase() !== draft.data.toLowerCase()) {
    throw new ValidationError('Signed tx data does not match the authorized transfer.');
  }
  // Ceilings.
  if (parsed.gas > ceilings.maxGas) {
    throw new ValidationError(`gas limit ${parsed.gas} exceeds ceiling ${ceilings.maxGas}.`);
  }
  if (parsed.value > ceilings.maxValueWei) {
    throw new ValidationError(`value ${parsed.value} exceeds ceiling ${ceilings.maxValueWei}.`);
  }
  if (parsed.maxFeePerGas > ceilings.maxFeePerGasWei) {
    throw new ValidationError(
      `maxFeePerGas ${parsed.maxFeePerGas} exceeds ceiling ${ceilings.maxFeePerGasWei}.`,
    );
  }
  // The signer must be the sender the draft was built for.
  if (getAddress(parsed.from) !== getAddress(draft.from)) {
    throw new ValidationError('Signed tx signer does not match the transfer sender.');
  }
}

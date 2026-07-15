// Chain-safety verification for a client-signed chat-commit tx (AGENT.md §5).
//
// SERVER-ONLY, dependency-light (viem + typed errors). The server NEVER sees a
// private key — only a raw SIGNED tx — so before broadcasting it independently
// proves the signature covers exactly what `POST /api/chat` authorized:
//   1. chainId == pinned draft chainId AND the live active-network chainId.
//   2. `to` == the pinned ChatLog contract (no redirected commit).
//   3. `value` == 0 EXACTLY (a commit is non-payable).
//   4. `data` == the pinned `commit(contentHash, ref)` calldata.
//   5. gas / maxFeePerGas within the pinned ceilings.
//   6. recovered signer == the pinned `from`.
// Any breach throws a ValidationError (→ 400); the tx is NOT broadcast.
import { parseTransaction, recoverTransactionAddress, getAddress } from 'viem';
import type { Hex } from 'viem';
import { ValidationError } from '@/lib/errors';
import type { ChatCommitDraft } from './draft';
import type { ChatCeilings } from './ceilings';

export interface ParsedSignedCommit {
  chainId: number;
  to: string | null;
  value: bigint;
  gas: bigint;
  maxFeePerGas: bigint;
  data: Hex;
  from: string;
}

/** Parse + recover a raw signed tx into a normalized commit view. */
export async function parseSignedCommit(rawSignedTx: string): Promise<ParsedSignedCommit> {
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

export interface CommitPolicyContext {
  draft: ChatCommitDraft;
  activeChainId: number;
  ceilings: ChatCeilings;
}

/** Enforce every chain-safety invariant against a parsed signed commit. */
export function assertCommitWithinPolicy(
  parsed: ParsedSignedCommit,
  { draft, activeChainId, ceilings }: CommitPolicyContext,
): void {
  if (!ceilings.enabled) {
    throw new ValidationError('On-chain chat is currently disabled.');
  }
  if (parsed.to === null) {
    throw new ValidationError('Signed tx must have a `to` (a commit is never a contract creation).');
  }
  if (parsed.chainId !== draft.chainId || parsed.chainId !== activeChainId) {
    throw new ValidationError(`chainId mismatch: signed ${parsed.chainId} != active ${activeChainId}.`);
  }
  if (getAddress(parsed.to) !== getAddress(draft.txTo)) {
    throw new ValidationError('Signed tx `to` does not match the ChatLog contract.');
  }
  if (parsed.value !== 0n) {
    throw new ValidationError('A chat commit must not move value (value must be 0).');
  }
  if (parsed.data.toLowerCase() !== draft.data.toLowerCase()) {
    throw new ValidationError('Signed tx data does not match the authorized commit.');
  }
  if (parsed.gas > ceilings.maxGas) {
    throw new ValidationError(`gas limit ${parsed.gas} exceeds ceiling ${ceilings.maxGas}.`);
  }
  if (parsed.maxFeePerGas > ceilings.maxFeePerGasWei) {
    throw new ValidationError(
      `maxFeePerGas ${parsed.maxFeePerGas} exceeds ceiling ${ceilings.maxFeePerGasWei}.`,
    );
  }
  if (getAddress(parsed.from) !== getAddress(draft.from)) {
    throw new ValidationError('Signed tx signer does not match the commit sender.');
  }
}

// Chain-safety verification for a client-signed deploy tx (AGENT.md §5, SPEC §8.5).
//
// SERVER-ONLY but dependency-light (viem + typed errors). The server NEVER sees a
// private key — only a raw SIGNED tx — so before broadcasting it must independently
// prove the signature covers exactly what we authorized:
//
//   1. It is a contract CREATION (`to` is empty).
//   2. Its `chainId` equals BOTH the pinned draft chainId AND the live active
//      network chainId (checked by the caller against the live client too).
//   3. Its `data` equals the draft's pinned bytecode+ctor-args (the user signed
//      exactly what /estimate built — no swapped bytecode).
//   4. `gas`, `value`, and `maxFeePerGas`/`gasPrice` are within the pinned ceilings.
//   5. The recovered signer equals the draft's `ownerAddress` (the deployer).
//
// Any breach throws a ValidationError (→ 400) and the tx is NOT broadcast.
import { parseTransaction, recoverTransactionAddress, getAddress } from 'viem';
import type { Hex } from 'viem';
import { ValidationError } from '@/lib/errors';
import type { DeployDraft } from './draft';
import type { DeployCeilings } from './ceilings';

/** Normalized view of a parsed signed deploy tx (bigint amounts in memory). */
export interface ParsedSignedDeploy {
  chainId: number;
  /** `null` for a contract creation. */
  to: string | null;
  value: bigint;
  gas: bigint;
  /** Effective max fee (maxFeePerGas for 1559, else gasPrice). */
  maxFeePerGas: bigint;
  data: Hex;
  /** Recovered signer (checksummed). */
  from: string;
}

/** Parse + recover a raw signed tx into a normalized deploy view. */
export async function parseSignedDeploy(rawSignedTx: string): Promise<ParsedSignedDeploy> {
  const serialized = rawSignedTx as Hex;
  let tx;
  try {
    tx = parseTransaction(serialized);
  } catch {
    throw new ValidationError('rawSignedTx is not a valid transaction.');
  }

  // `recoverTransactionAddress` types `serializedTransaction` as the typed 0x02/
  // 0x01/… union; a raw client tx is a plain hex string, so narrow via the fn's
  // own parameter type (no `any`).
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

export interface DeployPolicyContext {
  draft: DeployDraft;
  /** The live active-network chainId (read from the resolver's client). */
  activeChainId: number;
  ceilings: DeployCeilings;
}

/**
 * Enforce every chain-safety invariant against a parsed signed deploy. Throws a
 * {@link ValidationError} on the first breach; returns cleanly when allowed.
 */
export function assertDeployWithinPolicy(
  parsed: ParsedSignedDeploy,
  { draft, activeChainId, ceilings }: DeployPolicyContext,
): void {
  if (!ceilings.enabled) {
    throw new ValidationError('Deployments are currently disabled.');
  }
  if (parsed.to !== null) {
    throw new ValidationError('Signed tx must be a contract creation (no `to`).');
  }
  // chainId must match the pinned draft AND the live active network.
  if (parsed.chainId !== draft.chainId || parsed.chainId !== activeChainId) {
    throw new ValidationError(
      `chainId mismatch: signed ${parsed.chainId} != active ${activeChainId}.`,
    );
  }
  // The signed calldata must equal exactly what /estimate authorized.
  if (parsed.data.toLowerCase() !== draft.data.toLowerCase()) {
    throw new ValidationError('Signed tx data does not match the authorized deployment.');
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
  // The signer must be the deployer the draft was built for.
  if (getAddress(parsed.from) !== getAddress(draft.ownerAddress)) {
    throw new ValidationError('Signed tx signer does not match the deployment owner.');
  }
}

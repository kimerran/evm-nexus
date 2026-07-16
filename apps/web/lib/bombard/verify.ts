// Sampling verification for client-signed bombard txs (AGENT.md §5, SPEC §8.7).
//
// SERVER-ONLY but dependency-light (viem + typed errors). The server NEVER sees a
// private key — only raw SIGNED txs — and a run can hold up to millions of them,
// so recovering + checking every signature at /start is infeasible. Instead we
// verify a SAMPLE (first + last, plus the count) against the HMAC-pinned plan:
// this cheaply catches a batch signed for the wrong chain, recipient, value,
// nonce base, or signer, while the per-tx guarantees the RPC itself enforces
// (valid signature, monotone nonce, sufficient balance) cover the rest. Client
// mode spends the USER's OWN key, so the abuse surface is throughput (bounded by
// the ceilings + single-run + kill-switch), not fund redirection.
import { parseTransaction, recoverTransactionAddress, getAddress } from 'viem';
import type { Hex } from 'viem';
import { ValidationError } from '@/lib/errors';
import type { BombardPlan } from './draft';

/** Verify one signed tx at `index` matches exactly what the plan pinned. */
async function assertMatchesPlan(rawTx: string, index: number, plan: BombardPlan): Promise<void> {
  const serialized = rawTx as Hex;
  let tx;
  try {
    tx = parseTransaction(serialized);
  } catch {
    throw new ValidationError(`Signed tx #${index} is not a valid transaction.`);
  }

  const chainId = typeof tx.chainId === 'number' ? tx.chainId : Number(tx.chainId ?? 0);
  if (chainId !== plan.chainId) {
    throw new ValidationError(`Signed tx #${index} chainId ${chainId} != plan ${plan.chainId}.`);
  }
  if (!tx.to || getAddress(tx.to) !== getAddress(plan.to)) {
    throw new ValidationError(`Signed tx #${index} recipient does not match the plan.`);
  }
  if ((tx.value ?? 0n) !== BigInt(plan.amountPerTxWei)) {
    throw new ValidationError(`Signed tx #${index} value does not match the plan.`);
  }
  if ((tx.data ?? '0x') !== '0x') {
    throw new ValidationError(`Signed tx #${index} must be a bare native transfer (no calldata).`);
  }
  const expectedNonce = plan.startNonce + index;
  if (tx.nonce !== expectedNonce) {
    throw new ValidationError(
      `Signed tx #${index} nonce ${tx.nonce} != expected ${expectedNonce}.`,
    );
  }
  if ((tx.gas ?? 0n) > BigInt(plan.gas)) {
    throw new ValidationError(`Signed tx #${index} gas exceeds the plan ceiling.`);
  }
  // SPEC §13: gas/value/maxFee ceilings enforced before EVERY broadcast. The plan
  // pins the ceiling-checked maxFeePerGasWei (prepare re-checks it against the
  // AppSetting ceiling); the client's actual signed fee must not exceed it, or a
  // client could ship a bombard batch with an arbitrary maxFeePerGas unchecked.
  const maxFeePerGas = tx.maxFeePerGas ?? tx.gasPrice ?? 0n;
  if (maxFeePerGas > BigInt(plan.maxFeePerGasWei)) {
    throw new ValidationError(`Signed tx #${index} maxFeePerGas exceeds the plan ceiling.`);
  }

  type RecoverArg = Parameters<typeof recoverTransactionAddress>[0]['serializedTransaction'];
  const signer = await recoverTransactionAddress({
    serializedTransaction: serialized as RecoverArg,
  }).catch(() => {
    throw new ValidationError(`Signed tx #${index} signature could not be recovered.`);
  });
  if (getAddress(signer) !== getAddress(plan.from)) {
    throw new ValidationError(`Signed tx #${index} signer does not match the plan sender.`);
  }
}

/**
 * Validate a client-signed batch against the plan: the count must equal
 * `plan.totalCount`, and a sample (first + last tx) must match the pinned
 * chainId / recipient / value / nonce base / signer. Throws {@link ValidationError}
 * on the first breach; the batch is never staged or broadcast.
 */
export async function verifyBombardBatch(
  rawSignedTxs: readonly string[],
  plan: BombardPlan,
): Promise<void> {
  if (rawSignedTxs.length !== plan.totalCount) {
    throw new ValidationError(
      `Expected ${plan.totalCount} signed txs but received ${rawSignedTxs.length}.`,
    );
  }
  const lastIndex = rawSignedTxs.length - 1;
  const first = rawSignedTxs[0];
  if (first === undefined) throw new ValidationError('No signed txs provided.');
  await assertMatchesPlan(first, 0, plan);
  if (lastIndex > 0) {
    const last = rawSignedTxs[lastIndex];
    if (last !== undefined) await assertMatchesPlan(last, lastIndex, plan);
  }
}

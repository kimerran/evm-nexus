// UserOperation math for ERC-4337 v0.7 (SPEC §8.9, AGENT.md §4/§7).
//
// PURE + server/client-safe (viem only, no DB). All numeric fields cross process
// / wire boundaries as decimal STRINGS (wei / gas) and are parsed to bigint only
// in memory — never `Number()`-ed (AGENT.md §4). This module is the single source
// of truth for the UserOp shape shared by the web routes, the worker, and the
// browser signer, plus the helpers that build `execute` calldata, pack the op for
// the paymaster's on-chain `getHash`, and compute the `userOpHash` the owner signs.
import { encodeFunctionData, concat, toHex, size } from 'viem';
import type { Address, Hex } from 'viem';
import {
  getUserOperationHash,
  toPackedUserOperation,
  type UserOperation,
  type PackedUserOperation,
} from 'viem/account-abstraction';
import { SimpleAccountAbi, SimpleAccountFactoryAbi } from '@nexus/types';
import { ENTRYPOINT_VERSION } from './constants';

/**
 * Wire/at-rest form of a v0.7 UserOperation. Numeric fields are decimal strings.
 * Paymaster + factory fields are optional (a deployed account omits factory; an
 * un-sponsored op omits paymaster). `signature` defaults to `0x` until the owner
 * signs the `userOpHash`.
 */
export interface SerializedUserOperation {
  sender: Address;
  nonce: string;
  factory?: Address;
  factoryData?: Hex;
  callData: Hex;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  paymaster?: Address;
  paymasterVerificationGasLimit?: string;
  paymasterPostOpGasLimit?: string;
  paymasterData?: Hex;
  signature: Hex;
}

/** Build the SimpleAccount `execute(dest, value, func)` calldata for an inner call. */
export function buildExecuteCallData(call: { to: Address; value: bigint; data: Hex }): Hex {
  return encodeFunctionData({
    abi: SimpleAccountAbi,
    functionName: 'execute',
    args: [call.to, call.value, call.data],
  });
}

/** Build the SimpleAccountFactory `createAccount(owner, salt)` calldata (factoryData). */
export function buildCreateAccountData(owner: Address, salt: bigint): Hex {
  return encodeFunctionData({
    abi: SimpleAccountFactoryAbi,
    functionName: 'createAccount',
    args: [owner, salt],
  });
}

/** Build v0.7 initCode `factory ++ factoryData` (empty when the account exists). */
export function buildInitCode(factory?: Address, factoryData?: Hex): Hex {
  if (!factory || !factoryData) return '0x';
  return concat([factory, factoryData]);
}

/** Convert the wire form into the viem in-memory UserOperation (bigint fields). */
export function toViemUserOperation(op: SerializedUserOperation): UserOperation<'0.7'> {
  const base = {
    sender: op.sender,
    nonce: BigInt(op.nonce),
    callData: op.callData,
    callGasLimit: BigInt(op.callGasLimit),
    verificationGasLimit: BigInt(op.verificationGasLimit),
    preVerificationGas: BigInt(op.preVerificationGas),
    maxFeePerGas: BigInt(op.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(op.maxPriorityFeePerGas),
    signature: op.signature,
    ...(op.factory ? { factory: op.factory } : {}),
    ...(op.factoryData ? { factoryData: op.factoryData } : {}),
    ...(op.paymaster ? { paymaster: op.paymaster } : {}),
    ...(op.paymasterData ? { paymasterData: op.paymasterData } : {}),
    ...(op.paymasterVerificationGasLimit
      ? { paymasterVerificationGasLimit: BigInt(op.paymasterVerificationGasLimit) }
      : {}),
    ...(op.paymasterPostOpGasLimit
      ? { paymasterPostOpGasLimit: BigInt(op.paymasterPostOpGasLimit) }
      : {}),
  };
  return base as UserOperation<'0.7'>;
}

/** Pack a UserOp into the on-chain `PackedUserOperation` struct (for handleOps/getHash). */
export function toPacked(op: SerializedUserOperation): PackedUserOperation {
  return toPackedUserOperation(toViemUserOperation(op));
}

/** Compute the EntryPoint v0.7 `userOpHash` the account owner signs. */
export function computeUserOpHash(
  op: SerializedUserOperation,
  entryPointAddress: Address,
  chainId: number,
): Hex {
  return getUserOperationHash({
    chainId,
    entryPointAddress,
    entryPointVersion: ENTRYPOINT_VERSION,
    userOperation: toViemUserOperation(op),
  });
}

/**
 * Assemble the paymaster `paymasterData` trailer exactly as the reference
 * VerifyingPaymaster expects: `abi.encode(validUntil, validAfter)` (two 32-byte
 * words) followed by the 65-byte signer signature. Combined with the paymaster
 * address + the two gas-limit fields (added by {@link toPackedUserOperation}),
 * this reproduces the on-chain `paymasterAndData` layout.
 */
export function buildPaymasterData(validUntil: number, validAfter: number, signature: Hex): Hex {
  const validUntilWord = toHex(BigInt(validUntil), { size: 32 });
  const validAfterWord = toHex(BigInt(validAfter), { size: 32 });
  return concat([validUntilWord, validAfterWord, signature]);
}

/** Worst-case gas cost (wei) of a UserOp — sum of gas limits × maxFeePerGas. */
export function userOpMaxCostWei(op: SerializedUserOperation): bigint {
  const totalGas =
    BigInt(op.verificationGasLimit) +
    BigInt(op.callGasLimit) +
    BigInt(op.preVerificationGas) +
    BigInt(op.paymasterVerificationGasLimit ?? '0') +
    BigInt(op.paymasterPostOpGasLimit ?? '0');
  return totalGas * BigInt(op.maxFeePerGas);
}

/** Byte length of a hex string's payload (helper for validating a signature). */
export function hexByteLength(value: Hex): number {
  return size(value);
}

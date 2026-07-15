// Unit tests for the pure UserOp math (SPEC §8.9, AGENT.md §4/§7).
import { describe, it, expect } from 'vitest';
import { toFunctionSelector, size, getAddress } from 'viem';
import type { Hex } from 'viem';
import {
  buildExecuteCallData,
  buildCreateAccountData,
  buildPaymasterData,
  userOpMaxCostWei,
  computeUserOpHash,
  type SerializedUserOperation,
} from './userop';

const OWNER = getAddress('0x976EA74026E726554dB657fA54763abd0C3a0aa9');
const TARGET = getAddress('0x000000000000000000000000000000000000dEaD');
const ENTRYPOINT = getAddress('0x0000000071727De22E5E9d8BAf0edAc6f37da032');

function baseOp(): SerializedUserOperation {
  return {
    sender: getAddress('0xbB7C7A5c84d8D1497d65206F0Fd53a93bFA71da8'),
    nonce: '0',
    callData: buildExecuteCallData({ to: TARGET, value: 10n, data: '0x' }),
    callGasLimit: '600000',
    verificationGasLimit: '1500000',
    preVerificationGas: '120000',
    maxFeePerGas: '20000000000',
    maxPriorityFeePerGas: '1000000000',
    paymaster: getAddress('0xA7918D253764E42d60C3ce2010a34d5a1e7C1398'),
    paymasterVerificationGasLimit: '300000',
    paymasterPostOpGasLimit: '120000',
    paymasterData: '0x',
    signature: '0x',
  };
}

describe('buildExecuteCallData', () => {
  it('encodes SimpleAccount.execute(dest,value,func)', () => {
    const data = buildExecuteCallData({ to: TARGET, value: 1n, data: '0x' });
    expect(data.startsWith(toFunctionSelector('execute(address,uint256,bytes)'))).toBe(true);
  });
});

describe('buildCreateAccountData', () => {
  it('encodes SimpleAccountFactory.createAccount(owner,salt)', () => {
    const data = buildCreateAccountData(OWNER, 42n);
    expect(data.startsWith(toFunctionSelector('createAccount(address,uint256)'))).toBe(true);
    // The owner is right-padded in the first arg word.
    expect(data.toLowerCase()).toContain(OWNER.slice(2).toLowerCase());
  });
});

describe('buildPaymasterData', () => {
  it('lays out abi.encode(validUntil,validAfter) (64 bytes) + signature', () => {
    const sig = `0x${'11'.repeat(65)}` as Hex;
    const data = buildPaymasterData(1000, 0, sig);
    // 32 + 32 (two words) + 65 (signature) = 129 bytes.
    expect(size(data)).toBe(129);
    expect(data.endsWith('11'.repeat(65))).toBe(true);
  });
});

describe('userOpMaxCostWei', () => {
  it('sums every gas limit times maxFeePerGas', () => {
    const op = baseOp();
    const totalGas = 1_500_000n + 600_000n + 120_000n + 300_000n + 120_000n;
    expect(userOpMaxCostWei(op)).toBe(totalGas * 20_000_000_000n);
  });
});

describe('computeUserOpHash', () => {
  it('is deterministic for identical inputs', () => {
    const op = baseOp();
    const a = computeUserOpHash(op, ENTRYPOINT, 31337);
    const b = computeUserOpHash(op, ENTRYPOINT, 31337);
    expect(a).toBe(b);
    expect(size(a)).toBe(32);
  });

  it('changes when the chainId changes (replay protection)', () => {
    const op = baseOp();
    expect(computeUserOpHash(op, ENTRYPOINT, 31337)).not.toBe(computeUserOpHash(op, ENTRYPOINT, 1));
  });

  it('changes when the inner call changes', () => {
    const a = computeUserOpHash(baseOp(), ENTRYPOINT, 31337);
    const mutated = { ...baseOp(), callData: buildExecuteCallData({ to: TARGET, value: 999n, data: '0x' }) };
    expect(computeUserOpHash(mutated, ENTRYPOINT, 31337)).not.toBe(a);
  });

  it('ignores the (later-attached) signature — the account signs the hash', () => {
    const a = computeUserOpHash({ ...baseOp(), signature: '0x' }, ENTRYPOINT, 31337);
    const b = computeUserOpHash(
      { ...baseOp(), signature: (`0x${'22'.repeat(65)}`) as Hex },
      ENTRYPOINT,
      31337,
    );
    expect(a).toBe(b);
  });
});

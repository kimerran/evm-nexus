import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { verifyBombardBatch } from './verify';
import type { BombardPlan } from './draft';

// Anvil account #1 stands in for the in-browser vault signer (the bombard sender).
const PK: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const account = privateKeyToAccount(PK);
const FROM = getAddress(account.address);
const TO = getAddress('0xf39fd6e51aad88f6f4ce6ab8827279cffFb92266');

const PLAN_MAX_FEE = 2_000_000_000n; // 2 gwei ceiling pinned by /prepare

function plan(overrides: Partial<BombardPlan> = {}): BombardPlan {
  return {
    v: 1,
    userId: 'user-1',
    runId: 'run-1',
    networkId: 'net-1',
    chainId: 31337,
    mode: 'CLIENT_SIGNED',
    from: FROM,
    to: TO,
    amountPerTxWei: '1000000000000000',
    startNonce: 0,
    totalCount: 1,
    targetTps: 5,
    gas: '21000',
    maxFeePerGasWei: PLAN_MAX_FEE.toString(),
    maxPriorityFeePerGasWei: '1000000000',
    exp: Date.now() + 60_000,
    ...overrides,
  };
}

function signTx(opts: { maxFeePerGas?: bigint } = {}): Promise<Hex> {
  return account.signTransaction({
    type: 'eip1559',
    chainId: 31337,
    nonce: 0,
    to: TO,
    value: 1_000_000_000_000_000n,
    data: '0x',
    gas: 21_000n,
    maxFeePerGas: opts.maxFeePerGas ?? PLAN_MAX_FEE,
    maxPriorityFeePerGas: 1_000_000_000n,
  });
}

describe('verifyBombardBatch — maxFeePerGas ceiling (SPEC §13 before-broadcast)', () => {
  it('accepts a batch whose signed maxFeePerGas is within the plan ceiling', async () => {
    const raw = await signTx({ maxFeePerGas: PLAN_MAX_FEE });
    await expect(verifyBombardBatch([raw], plan())).resolves.toBeUndefined();
  });

  it('rejects a signed tx whose maxFeePerGas exceeds the plan ceiling', async () => {
    // Client signs with a fee above the ceiling the plan pinned — must be rejected
    // before any broadcast (regression for issue #18 GAP-1).
    const raw = await signTx({ maxFeePerGas: PLAN_MAX_FEE + 1n });
    await expect(verifyBombardBatch([raw], plan())).rejects.toThrow(/maxFeePerGas exceeds/i);
  });
});

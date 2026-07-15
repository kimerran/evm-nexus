import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { parseSignedTransfer, assertTransferWithinPolicy } from './verify';
import { buildTransferCall } from './calldata';
import type { TransferDraft } from './draft';
import type { TransferCeilings } from './ceilings';
import type { TransferRequest } from './schema';

// Anvil account #1 — stands in for the in-browser vault signer (the sender).
const PK: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const account = privateKeyToAccount(PK);
const FROM = getAddress(account.address); // anvil #1 (signer/sender)
const TO = getAddress('0xf39fd6e51aad88f6f4ce6ab8827279cffFb92266'); // anvil #0 (recipient)
const OTHER = getAddress('0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc'); // anvil #2
const TOKEN = getAddress('0x5fbdb2315678afecb367f032d93f642f64180aa3');

const CEILINGS: TransferCeilings = {
  enabled: true,
  maxGas: 500_000n,
  maxValueWei: 1_000_000_000_000_000_000_000n,
  maxFeePerGasWei: 1_000_000_000_000n,
};

const NATIVE_REQ: TransferRequest = {
  kind: 'NATIVE',
  from: FROM,
  to: TO,
  amount: '1000000000000000000',
  sponsored: false,
};
const nativeCall = buildTransferCall(NATIVE_REQ);

function nativeDraft(overrides: Partial<TransferDraft> = {}): TransferDraft {
  return {
    v: 1,
    userId: 'user-1',
    networkId: 'net-1',
    chainId: 31337,
    kind: 'NATIVE',
    from: FROM,
    to: TO,
    tokenAddress: null,
    tokenId: null,
    amount: '1000000000000000000',
    txTo: nativeCall.to,
    txValue: nativeCall.value.toString(),
    data: nativeCall.data,
    maxGas: '500000',
    maxValueWei: '1000000000000000000000',
    maxFeePerGasWei: '1000000000000',
    exp: Date.now() + 60_000,
    ...overrides,
  };
}

async function signTransfer(opts: {
  chainId?: number;
  to?: Hex;
  value?: bigint;
  data?: Hex;
  gas?: bigint;
  signer?: ReturnType<typeof privateKeyToAccount>;
}): Promise<Hex> {
  const signer = opts.signer ?? account;
  return signer.signTransaction({
    type: 'eip1559',
    chainId: opts.chainId ?? 31337,
    nonce: 0,
    to: (opts.to ?? (nativeCall.to as Hex)) as Hex,
    value: opts.value ?? nativeCall.value,
    data: opts.data ?? nativeCall.data,
    gas: opts.gas ?? 21_000n,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
  });
}

describe('parseSignedTransfer + assertTransferWithinPolicy (chain-safety before broadcast)', () => {
  it('accepts a well-formed native transfer', async () => {
    const raw = await signTransfer({});
    const parsed = await parseSignedTransfer(raw);
    expect(parsed.chainId).toBe(31337);
    expect(getAddress(parsed.from)).toBe(FROM);
    expect(() =>
      assertTransferWithinPolicy(parsed, { draft: nativeDraft(), activeChainId: 31337, ceilings: CEILINGS }),
    ).not.toThrow();
  });

  it('rejects a chainId mismatch (signed 1 != active 31337)', async () => {
    const raw = await signTransfer({ chainId: 1 });
    const parsed = await parseSignedTransfer(raw);
    expect(() =>
      assertTransferWithinPolicy(parsed, {
        draft: nativeDraft({ chainId: 31337 }),
        activeChainId: 31337,
        ceilings: CEILINGS,
      }),
    ).toThrow(/chainId mismatch/i);
  });

  it('rejects a redirected recipient (`to` != pinned target)', async () => {
    const raw = await signTransfer({ to: OTHER as Hex });
    const parsed = await parseSignedTransfer(raw);
    expect(() =>
      assertTransferWithinPolicy(parsed, { draft: nativeDraft(), activeChainId: 31337, ceilings: CEILINGS }),
    ).toThrow(/does not match the authorized transfer target/i);
  });

  it('rejects an inflated native value (!= pinned amount)', async () => {
    const raw = await signTransfer({ value: 2_000_000_000_000_000_000n });
    const parsed = await parseSignedTransfer(raw);
    expect(() =>
      assertTransferWithinPolicy(parsed, { draft: nativeDraft(), activeChainId: 31337, ceilings: CEILINGS }),
    ).toThrow(/value does not match/i);
  });

  it('enforces the gas ceiling', async () => {
    const raw = await signTransfer({ gas: 600_000n });
    const parsed = await parseSignedTransfer(raw);
    expect(() =>
      assertTransferWithinPolicy(parsed, { draft: nativeDraft(), activeChainId: 31337, ceilings: CEILINGS }),
    ).toThrow(/gas limit/i);
  });

  it('enforces the value ceiling', async () => {
    const bigValue = 2_000_000_000_000_000_000_000n; // 2000 ETH > 1000 ETH ceiling
    const raw = await signTransfer({ value: bigValue });
    const parsed = await parseSignedTransfer(raw);
    // Pin the draft to the same value so the exact-match check passes and the
    // ceiling is what rejects it.
    expect(() =>
      assertTransferWithinPolicy(parsed, {
        draft: nativeDraft({ txValue: bigValue.toString(), amount: bigValue.toString() }),
        activeChainId: 31337,
        ceilings: CEILINGS,
      }),
    ).toThrow(/exceeds ceiling/i);
  });

  it('rejects a signer that is not the sender', async () => {
    const other = privateKeyToAccount(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    );
    const raw = await signTransfer({ signer: other });
    const parsed = await parseSignedTransfer(raw);
    expect(() =>
      assertTransferWithinPolicy(parsed, { draft: nativeDraft(), activeChainId: 31337, ceilings: CEILINGS }),
    ).toThrow(/signer does not match/i);
  });

  it('rejects when the transfer kill-switch is disabled', async () => {
    const raw = await signTransfer({});
    const parsed = await parseSignedTransfer(raw);
    expect(() =>
      assertTransferWithinPolicy(parsed, {
        draft: nativeDraft(),
        activeChainId: 31337,
        ceilings: { ...CEILINGS, enabled: false },
      }),
    ).toThrow(/disabled/i);
  });

  it('rejects mismatched ERC20 calldata (swapped transfer args)', async () => {
    const erc20Call = buildTransferCall({
      kind: 'ERC20',
      from: FROM,
      to: TO,
      tokenAddress: TOKEN,
      amount: '500',
      sponsored: false,
    });
    // Sign a tx carrying different (tampered) calldata than the draft pins.
    const raw = await signTransfer({ to: TOKEN as Hex, value: 0n, data: '0x1234' as Hex });
    const parsed = await parseSignedTransfer(raw);
    const draft = nativeDraft({
      kind: 'ERC20',
      tokenAddress: TOKEN,
      amount: '500',
      txTo: TOKEN,
      txValue: '0',
      data: erc20Call.data,
    });
    expect(() =>
      assertTransferWithinPolicy(parsed, { draft, activeChainId: 31337, ceilings: CEILINGS }),
    ).toThrow(/data does not match/i);
  });
});

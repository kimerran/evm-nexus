import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { parseSignedDeploy, assertDeployWithinPolicy } from './verify';
import { buildDeployData } from './artifacts';
import type { DeployDraft } from './draft';
import type { DeployCeilings } from './ceilings';
import type { DeployRequest } from './schema';

// Anvil account #1 — stands in for the in-browser vault signer.
const PK: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const account = privateKeyToAccount(PK);
const OWNER = account.address;

const REQUEST: DeployRequest = {
  standard: 'ERC20',
  ownerAddress: getAddress(OWNER),
  name: 'Verify Token',
  symbol: 'VER',
  initialSupply: '1000',
  features: { mintable: true, burnable: false, pausable: true, permit: false },
};
const { data } = buildDeployData(REQUEST, OWNER);

const CEILINGS: DeployCeilings = {
  enabled: true,
  maxGas: 15_000_000n,
  maxValueWei: 0n,
  maxFeePerGasWei: 1_000_000_000_000n,
};

function draftFor(overrides: Partial<DeployDraft> = {}): DeployDraft {
  return {
    v: 1,
    userId: 'user-1',
    networkId: 'net-1',
    chainId: 31337,
    standard: 'ERC20',
    contractName: 'NexusERC20',
    ownerAddress: getAddress(OWNER),
    name: 'Verify Token',
    symbol: 'VER',
    initialSupply: '1000',
    baseUri: null,
    features: REQUEST.features,
    data,
    maxGas: '15000000',
    maxValueWei: '0',
    maxFeePerGasWei: '1000000000000',
    exp: Date.now() + 60_000,
    ...overrides,
  };
}

async function signDeploy(opts: {
  chainId?: number;
  gas?: bigint;
  value?: bigint;
  data?: Hex;
  signer?: ReturnType<typeof privateKeyToAccount>;
}): Promise<Hex> {
  const signer = opts.signer ?? account;
  return signer.signTransaction({
    type: 'eip1559',
    chainId: opts.chainId ?? 31337,
    nonce: 0,
    to: undefined,
    value: opts.value ?? 0n,
    data: opts.data ?? data,
    gas: opts.gas ?? 2_000_000n,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
  });
}

describe('parseSignedDeploy + assertDeployWithinPolicy (chain-safety before broadcast)', () => {
  it('accepts a well-formed client-signed deploy tx', async () => {
    const raw = await signDeploy({});
    const parsed = await parseSignedDeploy(raw);
    expect(parsed.to).toBeNull();
    expect(parsed.chainId).toBe(31337);
    expect(getAddress(parsed.from)).toBe(getAddress(OWNER));
    expect(() =>
      assertDeployWithinPolicy(parsed, { draft: draftFor(), activeChainId: 31337, ceilings: CEILINGS }),
    ).not.toThrow();
  });

  it('rejects a chainId mismatch (signed 1 != active 31337)', async () => {
    const raw = await signDeploy({ chainId: 1 });
    const parsed = await parseSignedDeploy(raw);
    expect(() =>
      assertDeployWithinPolicy(parsed, {
        draft: draftFor({ chainId: 31337 }),
        activeChainId: 31337,
        ceilings: CEILINGS,
      }),
    ).toThrow(/chainId mismatch/i);
  });

  it('enforces the gas ceiling', async () => {
    const raw = await signDeploy({ gas: 20_000_000n });
    const parsed = await parseSignedDeploy(raw);
    expect(() =>
      assertDeployWithinPolicy(parsed, { draft: draftFor(), activeChainId: 31337, ceilings: CEILINGS }),
    ).toThrow(/gas limit/i);
  });

  it('enforces the value ceiling (deploys are non-payable)', async () => {
    const raw = await signDeploy({ value: 5n });
    const parsed = await parseSignedDeploy(raw);
    expect(() =>
      assertDeployWithinPolicy(parsed, { draft: draftFor(), activeChainId: 31337, ceilings: CEILINGS }),
    ).toThrow(/value/i);
  });

  it('rejects a tx whose data differs from the authorized deployment', async () => {
    const raw = await signDeploy({ data: '0x1234' as Hex });
    const parsed = await parseSignedDeploy(raw);
    expect(() =>
      assertDeployWithinPolicy(parsed, { draft: draftFor(), activeChainId: 31337, ceilings: CEILINGS }),
    ).toThrow(/does not match/i);
  });

  it('rejects a signer that is not the deployment owner', async () => {
    const other = privateKeyToAccount(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    );
    const raw = await signDeploy({ signer: other });
    const parsed = await parseSignedDeploy(raw);
    expect(() =>
      assertDeployWithinPolicy(parsed, { draft: draftFor(), activeChainId: 31337, ceilings: CEILINGS }),
    ).toThrow(/signer/i);
  });

  it('rejects a disabled deploy kill-switch', async () => {
    const raw = await signDeploy({});
    const parsed = await parseSignedDeploy(raw);
    expect(() =>
      assertDeployWithinPolicy(parsed, {
        draft: draftFor(),
        activeChainId: 31337,
        ceilings: { ...CEILINGS, enabled: false },
      }),
    ).toThrow(/disabled/i);
  });
});

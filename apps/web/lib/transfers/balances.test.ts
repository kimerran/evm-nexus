import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import { readAssetBalance, type ContractReader } from './balances';

const TOKEN = getAddress('0x5fbdb2315678afecb367f032d93f642f64180aa3');
const OWNER = getAddress('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
const HOLDER = getAddress('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');

/** Build a fake reader that records the calls it receives and returns fixtures. */
function fakeReader(
  responses: Record<string, unknown>,
): { read: ContractReader; calls: { functionName: string; args: readonly unknown[] }[] } {
  const calls: { functionName: string; args: readonly unknown[] }[] = [];
  const read = (async (p: { functionName: string; args: readonly unknown[] }) => {
    calls.push({ functionName: p.functionName, args: p.args });
    return responses[p.functionName];
  }) as ContractReader;
  return { read, calls };
}

describe('readAssetBalance — RPC token reads', () => {
  it('ERC20 → balanceOf(owner) as a decimal string', async () => {
    const { read, calls } = fakeReader({ balanceOf: 4_200n });
    const res = await readAssetBalance(read, { kind: 'ERC20', tokenAddress: TOKEN, owner: OWNER });
    expect(res.balance).toBe('4200');
    expect(res.tokenId).toBeNull();
    expect(res.ownerOf).toBeNull();
    expect(calls[0]).toEqual({ functionName: 'balanceOf', args: [OWNER] });
  });

  it('ERC721 → balanceOf(owner) plus ownerOf(tokenId) when a tokenId is given', async () => {
    const { read, calls } = fakeReader({ balanceOf: 2n, ownerOf: HOLDER });
    const res = await readAssetBalance(read, {
      kind: 'ERC721',
      tokenAddress: TOKEN,
      owner: OWNER,
      tokenId: '7',
    });
    expect(res.balance).toBe('2');
    expect(res.ownerOf).toBe(HOLDER);
    expect(calls).toEqual([
      { functionName: 'balanceOf', args: [OWNER] },
      { functionName: 'ownerOf', args: [7n] },
    ]);
  });

  it('ERC1155 → balanceOf(owner, id)', async () => {
    const { read, calls } = fakeReader({ balanceOf: 15n });
    const res = await readAssetBalance(read, {
      kind: 'ERC1155',
      tokenAddress: TOKEN,
      owner: OWNER,
      tokenId: '3',
    });
    expect(res.balance).toBe('15');
    expect(res.tokenId).toBe('3');
    expect(calls[0]).toEqual({ functionName: 'balanceOf', args: [OWNER, 3n] });
  });

  it('ERC1155 requires a tokenId', async () => {
    const { read } = fakeReader({ balanceOf: 0n });
    await expect(
      readAssetBalance(read, { kind: 'ERC1155', tokenAddress: TOKEN, owner: OWNER }),
    ).rejects.toThrow(/tokenId is required/i);
  });
});

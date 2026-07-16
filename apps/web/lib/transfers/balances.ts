// Token balance/holdings reader for the asset-transfer UI (SPEC §8.6, AGENT.md §4).
//
// Reads via RPC (through a caller-supplied contract reader, so it is unit-testable
// without a live chain) against the COMMITTED token ABIs (#11):
//   • ERC20   → balanceOf(owner)            → balance (wei string)
//   • ERC721  → balanceOf(owner)            → count; + ownerOf(tokenId) when a
//               tokenId is supplied         → the current owner
//   • ERC1155 → balanceOf(owner, tokenId)   → balance for that id
//
// Balances are bigint in memory and serialized as decimal STRINGS — never floated.
import { getAddress } from 'viem';
import type { Abi } from 'viem';
import { NexusERC20Abi, NexusERC721Abi, NexusERC1155Abi } from '@nexus/types';
import { ValidationError } from '@/lib/errors';

export type AssetKind = 'ERC20' | 'ERC721' | 'ERC1155';

/** A minimal contract-read function (viem `readContract`-compatible, mockable). */
export type ContractReader = <T>(params: {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}) => Promise<T>;

export interface ReadBalanceParams {
  kind: AssetKind;
  tokenAddress: string;
  owner: string;
  /** Required for an ERC-1155 balance; optional for ERC-721 (adds ownerOf). */
  tokenId?: string;
}

/** Normalized balance/holdings result (all amounts as decimal strings). */
export interface AssetBalance {
  kind: AssetKind;
  tokenAddress: string;
  owner: string;
  tokenId: string | null;
  /** Fungible/holding balance as a decimal string (token count for ERC-721). */
  balance: string;
  /** ERC-721 owner of `tokenId`, when a tokenId was supplied; else null. */
  ownerOf: string | null;
}

/**
 * Read a token balance/holding for `owner`. Uses the standard's own ABI so an
 * overloaded `balanceOf` never resolves ambiguously across standards.
 */
export async function readAssetBalance(
  read: ContractReader,
  params: ReadBalanceParams,
): Promise<AssetBalance> {
  const tokenAddress = getAddress(params.tokenAddress);
  const owner = getAddress(params.owner);

  switch (params.kind) {
    case 'ERC20': {
      const balance = await read<bigint>({
        address: tokenAddress,
        abi: NexusERC20Abi as Abi,
        functionName: 'balanceOf',
        args: [owner],
      });
      return { kind: 'ERC20', tokenAddress, owner, tokenId: null, balance: balance.toString(), ownerOf: null };
    }
    case 'ERC721': {
      const balance = await read<bigint>({
        address: tokenAddress,
        abi: NexusERC721Abi as Abi,
        functionName: 'balanceOf',
        args: [owner],
      });
      let ownerOf: string | null = null;
      if (params.tokenId !== undefined) {
        const holder = await read<string>({
          address: tokenAddress,
          abi: NexusERC721Abi as Abi,
          functionName: 'ownerOf',
          args: [BigInt(params.tokenId)],
        });
        ownerOf = getAddress(holder);
      }
      return {
        kind: 'ERC721',
        tokenAddress,
        owner,
        tokenId: params.tokenId ?? null,
        balance: balance.toString(),
        ownerOf,
      };
    }
    case 'ERC1155': {
      if (params.tokenId === undefined) {
        throw new ValidationError('tokenId is required to read an ERC-1155 balance.');
      }
      const balance = await read<bigint>({
        address: tokenAddress,
        abi: NexusERC1155Abi as Abi,
        functionName: 'balanceOf',
        args: [owner, BigInt(params.tokenId)],
      });
      return {
        kind: 'ERC1155',
        tokenAddress,
        owner,
        tokenId: params.tokenId,
        balance: balance.toString(),
        ownerOf: null,
      };
    }
  }
}

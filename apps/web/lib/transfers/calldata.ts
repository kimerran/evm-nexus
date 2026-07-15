// Transfer-tx builder — turns a validated transfer request into the fully
// resolved unsigned tx target (`to`), native `value`, and ABI-encoded calldata
// (`data`) for each asset kind, using the COMMITTED token-template ABIs (#11)
// and viem (SPEC §8.6, AGENT.md §4/§7).
//
// PURE + server/client-safe (viem only, no DB). Amounts are bigint/wei in memory
// (parsed from wei/unit STRINGS, never `Number()`-ed). The on-chain call shapes:
//   • NATIVE   → value transfer: to = recipient, value = amount, data = 0x
//   • ERC20    → transfer(to, amount): to = token, value = 0
//   • ERC721   → safeTransferFrom(from, to, tokenId): to = token, value = 0
//   • ERC1155  → safeTransferFrom(from, to, id, amount, "0x"): to = token, value = 0
import { encodeFunctionData, getAddress } from 'viem';
import type { Hex } from 'viem';
import { NexusERC20Abi, NexusERC721Abi, NexusERC1155Abi } from '@nexus/types';
import type { TransferRequest } from './schema';

/** The resolved on-chain call for a transfer — the exact tx fields to be signed. */
export interface TransferCall {
  /** The tx `to`: the recipient (native) or the token contract (asset). */
  to: string;
  /** The tx `value` in wei (non-zero only for a native transfer). */
  value: bigint;
  /** The tx calldata (`0x` for a native transfer). */
  data: Hex;
}

/**
 * Build the unsigned tx target/value/calldata for a transfer request. `from` is
 * the sender's public address (the vault keypair that will sign) — required by
 * the ERC-721/1155 `safeTransferFrom(from, …)` signatures. Every address is
 * checksummed; every amount/tokenId is parsed to bigint here (never floated).
 */
export function buildTransferCall(request: TransferRequest): TransferCall {
  switch (request.kind) {
    case 'NATIVE': {
      return {
        to: getAddress(request.to),
        value: BigInt(request.amount),
        data: '0x',
      };
    }
    case 'ERC20': {
      const data = encodeFunctionData({
        abi: NexusERC20Abi,
        functionName: 'transfer',
        args: [getAddress(request.to), BigInt(request.amount)],
      });
      return { to: getAddress(request.tokenAddress), value: 0n, data };
    }
    case 'ERC721': {
      const data = encodeFunctionData({
        abi: NexusERC721Abi,
        functionName: 'safeTransferFrom',
        args: [getAddress(request.from), getAddress(request.to), BigInt(request.tokenId)],
      });
      return { to: getAddress(request.tokenAddress), value: 0n, data };
    }
    case 'ERC1155': {
      const data = encodeFunctionData({
        abi: NexusERC1155Abi,
        functionName: 'safeTransferFrom',
        args: [
          getAddress(request.from),
          getAddress(request.to),
          BigInt(request.tokenId),
          BigInt(request.amount),
          '0x',
        ],
      });
      return { to: getAddress(request.tokenAddress), value: 0n, data };
    }
  }
}

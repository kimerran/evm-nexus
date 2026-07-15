// GET /api/assets/:address/balances?owner=0x…&kind=ERC20|ERC721|ERC1155&tokenId=…
// — read a token balance/holdings via RPC for the asset-transfer UI (SPEC §8.6).
//
// Auth re-checked here. Reads are performed through the active-network resolver's
// public client (only admin-approved networks are ever used). Balances are bigint
// in memory and returned as decimal STRINGS (never floats). `kind` defaults to
// ERC20; ERC1155 requires a `tokenId`.
import type { NextRequest } from 'next/server';
import { getAddress, isAddress } from 'viem';
import type { Abi } from 'viem';
import { jsonOk, toErrorResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { ValidationError } from '@/lib/errors';
import { getPublicClient } from '@/lib/chain/resolver';
import { readAssetBalance, type AssetKind, type ContractReader } from '@/lib/transfers/balances';

export const dynamic = 'force-dynamic';

const KINDS: readonly AssetKind[] = ['ERC20', 'ERC721', 'ERC1155'];

export async function GET(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  try {
    await requireAuth(req);
    const { address } = await ctx.params;
    if (!isAddress(address)) throw new ValidationError('Invalid token address.');

    const params = new URL(req.url).searchParams;
    const owner = params.get('owner');
    if (!owner || !isAddress(owner)) throw new ValidationError('A valid `owner` address is required.');

    const kindParam = params.get('kind') ?? 'ERC20';
    if (!(KINDS as readonly string[]).includes(kindParam)) {
      throw new ValidationError('kind must be ERC20, ERC721, or ERC1155.');
    }
    const kind = kindParam as AssetKind;

    const tokenIdParam = params.get('tokenId');
    if (tokenIdParam !== null && !/^[0-9]+$/.test(tokenIdParam)) {
      throw new ValidationError('tokenId must be a non-negative integer string.');
    }
    const tokenId = tokenIdParam ?? undefined;

    const client = await getPublicClient();
    // Adapt viem's heavily-overloaded `readContract` to the narrow ContractReader
    // shape via a single cast (the balances lib specifies the concrete `T`).
    const read = ((p: { address: `0x${string}`; abi: Abi; functionName: string; args: readonly unknown[] }) =>
      client.readContract({
        address: p.address,
        abi: p.abi,
        functionName: p.functionName,
        args: p.args,
      })) as ContractReader;

    const balance = await readAssetBalance(read, {
      kind,
      tokenAddress: getAddress(address),
      owner: getAddress(owner),
      tokenId,
    });

    return jsonOk({ balance });
  } catch (err) {
    return toErrorResponse(err);
  }
}

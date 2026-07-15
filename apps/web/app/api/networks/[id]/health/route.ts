// GET /api/networks/:id/health — live chain metrics (SPEC §8.2).
//
// Any authenticated caller. Builds a viem public client from the network's
// (server-side, decoded) config via the resolver and reads live telemetry
// through the shared `lib/chain/health` reader: chainId, latest block height,
// gas price, derived block time, peer count and txpool status. Only
// admin-approved networks in the DB are ever dialed — never a browser-supplied
// RPC URL. Wei/heights are strings (AGENT.md §4). Nodes that lack
// `net_peerCount`/`txpool_status` report those fields as null (never a 500); a
// fully unreachable RPC maps to a clean 502.
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { jsonOk, jsonError } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { AppError, NotFoundError } from '@/lib/errors';
import { decodeRpcUrlFromStorage } from '@/lib/chain/rpc-url';
import { buildPublicClient } from '@/lib/chain/resolver';
import { readNetworkHealth } from '@/lib/chain/health';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(req);
    const { id } = await params;
    const network = await prisma.network.findUnique({ where: { id } });
    if (!network) throw new NotFoundError('Network not found.');

    const client = buildPublicClient({
      chainId: network.chainId,
      name: network.name,
      rpcUrl: decodeRpcUrlFromStorage(network.rpcUrl),
      wsUrl: network.wsUrl,
      nativeSymbol: network.nativeSymbol,
      nativeDecimals: network.nativeDecimals,
      explorerBaseUrl: network.explorerBaseUrl,
    });

    try {
      const health = await readNetworkHealth(client);
      return jsonOk({ networkId: network.id, name: network.name, ...health });
    } catch {
      return jsonError(502, 'RPC_UNREACHABLE', 'The network RPC endpoint could not be reached.');
    }
  } catch (err) {
    if (err instanceof AppError) return jsonError(err.status, err.code, err.message);
    return jsonError(500, 'INTERNAL', 'An unexpected error occurred.');
  }
}

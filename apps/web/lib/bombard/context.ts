// Active-network resolver for the bombard flow (SPEC §8.7, AGENT.md §5).
//
// SERVER-ONLY. Bombard only ever targets the admin-approved ACTIVE network
// (`isDefault = true`); a client-supplied `networkId` must equal it or the
// request is rejected. Returns the DB row id + chainId needed to pin the plan and
// persist the BombardRun.
import { prisma } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';

/** Minimal active-network identity for a bombard run. */
export interface BombardNetwork {
  id: string;
  chainId: number;
  name: string;
  nativeSymbol: string;
  explorerBaseUrl: string | null;
}

/**
 * Resolve the active network for a bombard run. When `networkId` is provided it
 * MUST equal the active network — bombard never targets an arbitrary client-named
 * one.
 */
export async function resolveActiveBombardNetwork(networkId?: string): Promise<BombardNetwork> {
  const network = await prisma.network.findFirst({ where: { isDefault: true } });
  if (!network) throw new NotFoundError('No active (default) network is configured.');
  if (networkId && networkId !== network.id) {
    throw new ValidationError('Bombard is only available on the active network.');
  }
  return {
    id: network.id,
    chainId: network.chainId,
    name: network.name,
    nativeSymbol: network.nativeSymbol,
    explorerBaseUrl: network.explorerBaseUrl,
  };
}

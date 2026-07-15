// Active-network resolver for the transfer flow (SPEC §8.6, AGENT.md §5).
//
// SERVER-ONLY. Transfers only ever target the admin-approved ACTIVE network
// (`isDefault = true`); a client-supplied `networkId` must equal it or the
// request is rejected. Returns the DB row id + chainId needed to pin the draft
// and persist the Transfer.
import { prisma } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';

/** Minimal active-network identity for a transfer. */
export interface TransferNetwork {
  id: string;
  chainId: number;
  name: string;
  nativeSymbol: string;
  explorerBaseUrl: string | null;
}

/**
 * Resolve the active network for a transfer. When `networkId` is provided it MUST
 * equal the active network — transfers never target an arbitrary client-named one.
 */
export async function resolveActiveTransferNetwork(networkId?: string): Promise<TransferNetwork> {
  const network = await prisma.network.findFirst({ where: { isDefault: true } });
  if (!network) throw new NotFoundError('No active (default) network is configured.');
  if (networkId && networkId !== network.id) {
    throw new ValidationError('Transfers are only available on the active network.');
  }
  return {
    id: network.id,
    chainId: network.chainId,
    name: network.name,
    nativeSymbol: network.nativeSymbol,
    explorerBaseUrl: network.explorerBaseUrl,
  };
}

// Active-network resolver for the smart-wallet flow (SPEC §8.9, AGENT.md §5).
//
// SERVER-ONLY. Smart-wallet operations only ever target the admin-approved ACTIVE
// network (`isDefault = true`); a client-supplied `networkId` must equal it or the
// request is rejected. Returns the DB row id + chainId needed to resolve the 4337
// stack and persist records.
import { prisma } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';

/** Minimal active-network identity for a smart-wallet operation. */
export interface SmartWalletNetwork {
  id: string;
  chainId: number;
  name: string;
  nativeSymbol: string;
  explorerBaseUrl: string | null;
}

/** Resolve the active network for a smart-wallet operation. */
export async function resolveActiveSmartWalletNetwork(networkId?: string): Promise<SmartWalletNetwork> {
  const network = await prisma.network.findFirst({ where: { isDefault: true } });
  if (!network) throw new NotFoundError('No active (default) network is configured.');
  if (networkId && networkId !== network.id) {
    throw new ValidationError('Smart wallets are only available on the active network.');
  }
  return {
    id: network.id,
    chainId: network.chainId,
    name: network.name,
    nativeSymbol: network.nativeSymbol,
    explorerBaseUrl: network.explorerBaseUrl,
  };
}

// Active-network resolver for the chat flow (SPEC §8.8, AGENT.md §5).
//
// SERVER-ONLY. Chat commits only ever target the admin-approved ACTIVE network
// (`isDefault = true`); a client-supplied `networkId` must equal it or the
// request is rejected. Mirrors lib/transfers/context.
import { prisma } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';

export interface ChatNetwork {
  id: string;
  chainId: number;
  name: string;
  nativeSymbol: string;
  explorerBaseUrl: string | null;
}

/** Resolve the active network for chat. When `networkId` is given it MUST match. */
export async function resolveActiveChatNetwork(networkId?: string): Promise<ChatNetwork> {
  const network = await prisma.network.findFirst({ where: { isDefault: true } });
  if (!network) throw new NotFoundError('No active (default) network is configured.');
  if (networkId && networkId !== network.id) {
    throw new ValidationError('Chat is only available on the active network.');
  }
  return {
    id: network.id,
    chainId: network.chainId,
    name: network.name,
    nativeSymbol: network.nativeSymbol,
    explorerBaseUrl: network.explorerBaseUrl,
  };
}

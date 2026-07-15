// Active-network resolver for the deployment flow (SPEC §8.5, AGENT.md §5).
//
// SERVER-ONLY. Deploys only ever target the admin-approved ACTIVE network
// (`isDefault = true`); a client-supplied `networkId` must equal it or the
// request is rejected. Returns the DB row id + chainId needed to pin the draft
// and persist the Deployment.
import { prisma } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';

/** Minimal active-network identity for a deploy. */
export interface DeployNetwork {
  id: string;
  chainId: number;
  name: string;
  explorerBaseUrl: string | null;
}

/**
 * Resolve the active network for a deploy. When `networkId` is provided it MUST
 * equal the active network — deploys never target an arbitrary client-named one.
 */
export async function resolveActiveDeployNetwork(networkId?: string): Promise<DeployNetwork> {
  const network = await prisma.network.findFirst({ where: { isDefault: true } });
  if (!network) throw new NotFoundError('No active (default) network is configured.');
  if (networkId && networkId !== network.id) {
    throw new ValidationError('Deployments are only available on the active network.');
  }
  return {
    id: network.id,
    chainId: network.chainId,
    name: network.name,
    explorerBaseUrl: network.explorerBaseUrl,
  };
}

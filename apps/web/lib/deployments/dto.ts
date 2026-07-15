// Serializable Deployment DTO shared by the API + the /launchpad page (SPEC §8.5).
//
// Money/units stay STRINGS over the wire (initialSupply wei, gasUsed, blockNumber
// as a decimal string) — never floats/BigInt-in-JSON. Nothing secret is carried.
import type { Deployment } from '@/lib/generated/prisma/client';

/** A deployment as returned to the client. */
export interface DeploymentView {
  id: string;
  standard: string;
  name: string;
  symbol: string | null;
  features: Record<string, boolean>;
  initialSupply: string | null;
  baseUri: string | null;
  status: string;
  txHash: string | null;
  contractAddress: string | null;
  blockNumber: string | null;
  gasUsed: string | null;
  errorMessage: string | null;
  networkId: string;
  createdAt: string;
}

/** Map a Deployment row to its client view. */
export function toDeploymentView(row: Deployment): DeploymentView {
  return {
    id: row.id,
    standard: row.standard,
    name: row.name,
    symbol: row.symbol,
    features:
      row.features && typeof row.features === 'object' && !Array.isArray(row.features)
        ? (row.features as Record<string, boolean>)
        : {},
    initialSupply: row.initialSupply,
    baseUri: row.baseUri,
    status: row.status,
    txHash: row.txHash,
    contractAddress: row.contractAddress,
    blockNumber: row.blockNumber === null ? null : row.blockNumber.toString(),
    gasUsed: row.gasUsed,
    errorMessage: row.errorMessage,
    networkId: row.networkId,
    createdAt: row.createdAt.toISOString(),
  };
}

// Serializable Transfer DTO shared by the API + the /transfers & /lab pages
// (SPEC §8.6).
//
// Money/units stay STRINGS over the wire (amount wei/units) — never floats/BigInt
// -in-JSON. Nothing secret is carried.
import type { Transfer } from '@/lib/generated/prisma/client';

/** A transfer as returned to the client. */
export interface TransferView {
  id: string;
  kind: string;
  fromAddress: string;
  toAddress: string;
  tokenAddress: string | null;
  tokenId: string | null;
  amount: string | null;
  sponsored: boolean;
  status: string;
  txHash: string | null;
  errorMessage: string | null;
  networkId: string;
  createdAt: string;
}

/** Map a Transfer row to its client view. */
export function toTransferView(row: Transfer): TransferView {
  return {
    id: row.id,
    kind: row.kind,
    fromAddress: row.fromAddress,
    toAddress: row.toAddress,
    tokenAddress: row.tokenAddress,
    tokenId: row.tokenId,
    amount: row.amount,
    sponsored: row.sponsored,
    status: row.status,
    txHash: row.txHash,
    errorMessage: row.errorMessage,
    networkId: row.networkId,
    createdAt: row.createdAt.toISOString(),
  };
}

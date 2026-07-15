// Serializable faucet DTOs shared by the API + the /faucet page (SPEC §8.4).
//
// Wei stays a STRING over the wire (never a float); Dates become ISO strings.
// Nothing secret is ever carried here.
import type { FaucetRequest } from '@/lib/generated/prisma/client';

/** A faucet request as returned to the client. */
export interface FaucetRequestView {
  id: string;
  toAddress: string;
  amount: string; // wei
  status: string;
  txHash: string | null;
  networkId: string;
  createdAt: string; // ISO
}

/** Map a FaucetRequest row to its client view (drops nothing sensitive). */
export function toFaucetRequestView(
  row: Pick<
    FaucetRequest,
    'id' | 'toAddress' | 'amount' | 'status' | 'txHash' | 'networkId' | 'createdAt'
  >,
): FaucetRequestView {
  return {
    id: row.id,
    toAddress: row.toAddress,
    amount: row.amount,
    status: row.status,
    txHash: row.txHash,
    networkId: row.networkId,
    createdAt: row.createdAt.toISOString(),
  };
}

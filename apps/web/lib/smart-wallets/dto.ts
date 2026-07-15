// SmartAccount DTO (SPEC §8.9). SERVER-safe, secret-free.
//
// Maps a SmartAccount row to the client-facing view. `isDeployed` is kept honest
// by {@link syncDeployment}: whenever accounts are listed, we check on-chain code
// and flip the flag, so the UI reflects reality whether the account was deployed
// via the factory `/deploy` path OR implicitly by a sponsored UserOp's initCode.
import type { PublicClient } from 'viem';
import { prisma } from '@/lib/db';

/** A SmartAccount row shape (subset used by the view). */
export interface SmartAccountRow {
  id: string;
  ownerAddress: string;
  accountAddress: string;
  networkId: string;
  factory: string | null;
  isDeployed: boolean;
  createdAt: Date;
}

/** Client-facing SmartAccount view. */
export interface SmartAccountView {
  id: string;
  ownerAddress: string;
  accountAddress: string;
  networkId: string;
  factory: string | null;
  isDeployed: boolean;
  createdAt: string;
}

export function toSmartAccountView(row: SmartAccountRow): SmartAccountView {
  return {
    id: row.id,
    ownerAddress: row.ownerAddress,
    accountAddress: row.accountAddress,
    networkId: row.networkId,
    factory: row.factory,
    isDeployed: row.isDeployed,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Reconcile the persisted `isDeployed` flag against on-chain code for a set of
 * accounts on one network. Only writes when a not-yet-deployed account has gained
 * code (the common case: a sponsored UserOp deployed it). Best-effort — a chain
 * read failure leaves the stored flag untouched.
 */
export async function syncDeployment<T extends SmartAccountRow>(
  rows: T[],
  publicClient: PublicClient,
): Promise<T[]> {
  const pending = rows.filter((r) => !r.isDeployed);
  if (pending.length === 0) return rows;
  const updated = new Map<string, boolean>();
  await Promise.all(
    pending.map(async (r) => {
      try {
        const code = await publicClient.getCode({ address: r.accountAddress as `0x${string}` });
        if (code && code !== '0x') updated.set(r.id, true);
      } catch {
        // leave the stored flag as-is on a read error
      }
    }),
  );
  if (updated.size > 0) {
    await prisma.smartAccount.updateMany({
      where: { id: { in: [...updated.keys()] } },
      data: { isDeployed: true },
    });
  }
  return rows.map((r) => (updated.get(r.id) ? { ...r, isDeployed: true } : r));
}

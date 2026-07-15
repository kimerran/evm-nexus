// Network mutation service (SPEC §8.2). Centralizes the write-side invariants so
// the route handlers stay thin: RPC-URL at-rest encoding, single-active-default
// enforcement, and the delete guard. AGENT.md §4: wei amounts stay strings.
import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/db';
import { ConflictError, NotFoundError } from '@/lib/errors';

/** Translate a Prisma unique-constraint violation into a clean 409. */
function rethrowAsConflict(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new ConflictError('A network with this chainId and name already exists.');
  }
  throw err;
}
import { encodeRpcUrlForStorage } from './rpc-url';
import type { CreateNetworkInput, UpdateNetworkInput } from './network-schema';

/**
 * Pure delete-guard decision (unit-tested). A network cannot be deleted while it
 * is the active/default network or while any record references it — the caller
 * must retarget the default or archive it instead. Throws {@link ConflictError}.
 */
export function assertNetworkDeletable(input: {
  isDefault: boolean;
  referenceCount: number;
}): void {
  if (input.isDefault) {
    throw new ConflictError(
      'Cannot delete the active (default) network. Set another network as default first.',
    );
  }
  if (input.referenceCount > 0) {
    throw new ConflictError(
      `Cannot delete a network referenced by ${input.referenceCount} record(s). Archive it instead.`,
    );
  }
}

/** Count every record that references a network across all relations. */
export async function countNetworkReferences(networkId: string): Promise<number> {
  const [deployments, transfers, bombardRuns, chatMessages, faucetRequests] = await Promise.all([
    prisma.deployment.count({ where: { networkId } }),
    prisma.transfer.count({ where: { networkId } }),
    prisma.bombardRun.count({ where: { networkId } }),
    prisma.chatMessage.count({ where: { networkId } }),
    prisma.faucetRequest.count({ where: { networkId } }),
  ]);
  return deployments + transfers + bombardRuns + chatMessages + faucetRequests;
}

/** Map validated create input to a Prisma create payload (encoding the RPC URL). */
function toCreateData(input: CreateNetworkInput): Prisma.NetworkCreateInput {
  return {
    name: input.name,
    chainId: input.chainId,
    rpcUrl: encodeRpcUrlForStorage(input.rpcUrl),
    wsUrl: input.wsUrl ?? null,
    explorerBaseUrl: input.explorerBaseUrl ?? null,
    nativeSymbol: input.nativeSymbol,
    nativeDecimals: input.nativeDecimals,
    isDefault: input.isDefault,
    isArchival: input.isArchival,
    faucetEnabled: input.faucetEnabled,
    faucetDripAmount: input.faucetDripAmount,
    faucetDailyCap: input.faucetDailyCap,
    faucetCooldownSec: input.faucetCooldownSec,
    paymasterAddress: input.paymasterAddress ?? null,
    entryPointAddress: input.entryPointAddress ?? null,
  };
}

/** Map validated update input to a Prisma update payload (only provided fields). */
function toUpdateData(input: UpdateNetworkInput): Prisma.NetworkUpdateInput {
  const data: Prisma.NetworkUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.chainId !== undefined) data.chainId = input.chainId;
  if (input.rpcUrl !== undefined) data.rpcUrl = encodeRpcUrlForStorage(input.rpcUrl);
  if (input.wsUrl !== undefined) data.wsUrl = input.wsUrl;
  if (input.explorerBaseUrl !== undefined) data.explorerBaseUrl = input.explorerBaseUrl;
  if (input.nativeSymbol !== undefined) data.nativeSymbol = input.nativeSymbol;
  if (input.nativeDecimals !== undefined) data.nativeDecimals = input.nativeDecimals;
  if (input.isArchival !== undefined) data.isArchival = input.isArchival;
  if (input.faucetEnabled !== undefined) data.faucetEnabled = input.faucetEnabled;
  if (input.faucetDripAmount !== undefined) data.faucetDripAmount = input.faucetDripAmount;
  if (input.faucetDailyCap !== undefined) data.faucetDailyCap = input.faucetDailyCap;
  if (input.faucetCooldownSec !== undefined) data.faucetCooldownSec = input.faucetCooldownSec;
  if (input.paymasterAddress !== undefined) data.paymasterAddress = input.paymasterAddress;
  if (input.entryPointAddress !== undefined) data.entryPointAddress = input.entryPointAddress;
  // isDefault is handled via setDefaultNetwork so exactly one row stays active.
  return data;
}

/** Create a network. When `isDefault`, atomically demote every other network. */
export async function createNetwork(input: CreateNetworkInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.network.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      return tx.network.create({ data: toCreateData(input) });
    });
  } catch (err) {
    rethrowAsConflict(err);
  }
}

/** Update a network's mutable fields (default flag is managed separately). */
export async function updateNetwork(id: string, input: UpdateNetworkInput) {
  const existing = await prisma.network.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Network not found.');

  // A caller may pass isDefault:true through PATCH; honor it via the same
  // single-active transaction rather than a bare field write.
  if (input.isDefault === true && !existing.isDefault) {
    await setDefaultNetwork(id);
  }
  try {
    return await prisma.network.update({ where: { id }, data: toUpdateData(input) });
  } catch (err) {
    rethrowAsConflict(err);
  }
}

/** Make `id` the single active/default network (atomic). */
export async function setDefaultNetwork(id: string) {
  const existing = await prisma.network.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Network not found.');

  return prisma.$transaction(async (tx) => {
    await tx.network.updateMany({
      where: { isDefault: true, NOT: { id } },
      data: { isDefault: false },
    });
    return tx.network.update({ where: { id }, data: { isDefault: true } });
  });
}

/** Delete a network after the delete-guard passes. */
export async function deleteNetwork(id: string) {
  const existing = await prisma.network.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Network not found.');

  const referenceCount = await countNetworkReferences(id);
  assertNetworkDeletable({ isDefault: existing.isDefault, referenceCount });

  await prisma.network.delete({ where: { id } });
}

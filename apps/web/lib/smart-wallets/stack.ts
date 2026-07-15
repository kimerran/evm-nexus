// ERC-4337 stack address resolution (SPEC §6/§8.9).
//
// SERVER-ONLY. Anvil has no canonical EntryPoint, so `scripts/deploy-4337.ts`
// deploys the EntryPoint + SimpleAccountFactory + VerifyingPaymaster and records
// their addresses in a single AppSetting row per network (no schema migration).
// These are PUBLIC addresses — never keys. Every route/worker that touches the
// 4337 flow resolves the stack here so a network without a deployed stack fails
// with a clear error instead of a confusing on-chain revert.
import { getAddress, isAddress } from 'viem';
import type { Address } from 'viem';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { stackSettingKey } from './keys';

/** The deployed 4337 stack for a network (all public addresses). */
export interface FourThirtySevenStack {
  entryPoint: Address;
  factory: Address;
  paymaster: Address;
  /** The paymaster's verifying-signer EOA (public address; the KEY is worker-only). */
  paymasterSigner: Address;
}

function parseStack(value: unknown): FourThirtySevenStack | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const fields = [v.entryPoint, v.factory, v.paymaster, v.paymasterSigner];
  if (!fields.every((f) => typeof f === 'string' && isAddress(f))) return null;
  return {
    entryPoint: getAddress(v.entryPoint as string),
    factory: getAddress(v.factory as string),
    paymaster: getAddress(v.paymaster as string),
    paymasterSigner: getAddress(v.paymasterSigner as string),
  };
}

/** Load the 4337 stack for a network, or `null` if it has not been deployed. */
export async function findStack(networkId: string): Promise<FourThirtySevenStack | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: stackSettingKey(networkId) } });
  if (!row) return null;
  return parseStack(row.value);
}

/** Load the 4337 stack for a network, throwing a clear 404 when it is absent. */
export async function requireStack(networkId: string): Promise<FourThirtySevenStack> {
  const stack = await findStack(networkId);
  if (!stack) {
    throw new NotFoundError(
      'The ERC-4337 stack is not deployed on the active network. Run scripts/deploy-4337.ts.',
    );
  }
  return stack;
}

/** Persist (upsert) the 4337 stack addresses for a network. Called by the deploy script. */
export async function saveStack(networkId: string, stack: FourThirtySevenStack): Promise<void> {
  const value = {
    entryPoint: getAddress(stack.entryPoint),
    factory: getAddress(stack.factory),
    paymaster: getAddress(stack.paymaster),
    paymasterSigner: getAddress(stack.paymasterSigner),
  };
  await prisma.appSetting.upsert({
    where: { key: stackSettingKey(networkId) },
    create: { key: stackSettingKey(networkId), value },
    update: { value },
  });
}

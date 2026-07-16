// ChatLog address store (SPEC §6/§8.8, AGENT.md §4).
//
// SERVER-ONLY (prisma). The per-network ChatLog contract address is stored in the
// existing key-value `AppSetting` model (no schema change) and read/written here.
// Pure hashing + calldata helpers live in ./hash so the worker can share them.
import { getAddress, isAddress } from 'viem';
import { prisma } from '@/lib/db';
import { chatLogAddressKey } from './hash';

export { chatLogAddressKey, computeContentHash, buildCommitCalldata } from './hash';

/** Read the deployed ChatLog address for a network. `null` when not deployed. */
export async function getChatLogAddress(networkId: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: chatLogAddressKey(networkId) } });
  if (!row) return null;
  const value = row.value as { address?: unknown } | null;
  const address = value && typeof value.address === 'string' ? value.address : null;
  return address && isAddress(address) ? getAddress(address) : null;
}

/** Store (upsert) the deployed ChatLog address for a network. */
export async function setChatLogAddress(networkId: string, address: string): Promise<void> {
  const checksummed = getAddress(address);
  await prisma.appSetting.upsert({
    where: { key: chatLogAddressKey(networkId) },
    create: { key: chatLogAddressKey(networkId), value: { address: checksummed } },
    update: { value: { address: checksummed } },
  });
}

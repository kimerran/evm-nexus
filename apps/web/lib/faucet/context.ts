// Faucet context loader — resolves the ACTIVE network's faucet config + the
// global kill-switch and assembles a policy input (SPEC §8.4/§9, AGENT.md §5).
//
// SERVER-ONLY (API boundary). The drip worker re-derives the same values from
// its own DB handle under a lock; this is the fast pre-check. Amounts are
// bigint/wei in memory, strings at rest. Only the admin-approved ACTIVE network
// (`isDefault = true`) is ever used — arbitrary client-supplied networks are
// rejected, so a drip can only ever target the approved chain.
import { prisma } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { FAUCET_ENABLED_SETTING, FAUCET_DAILY_WINDOW_SEC } from './keys';
import { summarizeFaucetUsage, type FaucetUsage } from './usage';

/** Decoded faucet parameters for one network (wei as bigint in memory). */
export interface FaucetNetwork {
  id: string;
  chainId: number;
  name: string;
  nativeSymbol: string;
  faucetEnabled: boolean;
  dripWei: bigint;
  dailyCapWei: bigint;
  cooldownSec: number;
}

/** Read the global faucet kill-switch (AppSetting `faucet.enabled`, default on). */
export async function isFaucetGloballyEnabled(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: FAUCET_ENABLED_SETTING } });
  // Missing setting fails SAFE-open (seed always creates it); only an explicit
  // `false` disables. Any non-boolean value is treated as disabled.
  if (!row) return true;
  return row.value === true;
}

/**
 * Resolve the active faucet network. When the caller passes a `networkId`, it
 * MUST equal the active network — the faucet only ever drips on the approved
 * active chain, never an arbitrary client-named one.
 */
export async function resolveActiveFaucetNetwork(networkId?: string): Promise<FaucetNetwork> {
  const network = await prisma.network.findFirst({ where: { isDefault: true } });
  if (!network) throw new NotFoundError('No active (default) network is configured.');
  if (networkId && networkId !== network.id) {
    throw new ValidationError('Faucet is only available on the active network.');
  }
  return {
    id: network.id,
    chainId: network.chainId,
    name: network.name,
    nativeSymbol: network.nativeSymbol,
    faucetEnabled: network.faucetEnabled,
    dripWei: BigInt(network.faucetDripAmount),
    dailyCapWei: BigInt(network.faucetDailyCap),
    cooldownSec: network.faucetCooldownSec,
  };
}

/**
 * Sum an address's recent usage on a network by loading its FaucetRequest rows
 * inside the widest relevant window and reducing them with the pure summarizer.
 */
export async function loadFaucetUsage(
  networkId: string,
  toAddress: string,
  cooldownSec: number,
  now: number = Date.now(),
): Promise<FaucetUsage> {
  const windowSec = Math.max(cooldownSec, FAUCET_DAILY_WINDOW_SEC);
  const since = new Date(now - windowSec * 1000);
  const rows = await prisma.faucetRequest.findMany({
    where: { networkId, toAddress, createdAt: { gte: since } },
    select: { amount: true, createdAt: true, status: true },
  });
  return summarizeFaucetUsage(rows, {
    now,
    cooldownSec,
    dailyWindowSec: FAUCET_DAILY_WINDOW_SEC,
  });
}

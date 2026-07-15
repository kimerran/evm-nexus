// GET /api/faucet/quota — remaining daily/global quota (SPEC §8.4).
//
// Auth re-checked here. Reports the active network's faucet ceilings and the
// caller-supplied address's current usage so the UI can show remaining quota,
// cooldown state, and whether the faucet is enabled. Amounts are wei STRINGS.
import type { NextRequest } from 'next/server';
import { getAddress, isAddress } from 'viem';
import { jsonOk, toErrorResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { ValidationError } from '@/lib/errors';
import {
  resolveActiveFaucetNetwork,
  isFaucetGloballyEnabled,
  loadFaucetUsage,
} from '@/lib/faucet/context';

export const dynamic = 'force-dynamic';

/** GET /api/faucet/quota?address=0x…&networkId=… — remaining quota for an address. */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);

    const params = new URL(req.url).searchParams;
    const rawAddress = params.get('address')?.trim() ?? '';
    if (!isAddress(rawAddress)) {
      throw new ValidationError('A valid `address` query parameter is required.');
    }
    const address = getAddress(rawAddress);
    const networkId = params.get('networkId')?.trim() || undefined;

    const network = await resolveActiveFaucetNetwork(networkId);
    const globallyEnabled = await isFaucetGloballyEnabled();
    const usage = await loadFaucetUsage(network.id, address, network.cooldownSec);

    const remainingWei =
      network.dailyCapWei > usage.dailyUsedWei ? network.dailyCapWei - usage.dailyUsedWei : 0n;

    return jsonOk({
      networkId: network.id,
      chainId: network.chainId,
      nativeSymbol: network.nativeSymbol,
      enabled: network.faucetEnabled && globallyEnabled,
      address,
      dripWei: network.dripWei.toString(),
      dailyCapWei: network.dailyCapWei.toString(),
      dailyUsedWei: usage.dailyUsedWei.toString(),
      remainingWei: remainingWei.toString(),
      cooldownSec: network.cooldownSec,
      cooldownActive: usage.cooldownActive,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

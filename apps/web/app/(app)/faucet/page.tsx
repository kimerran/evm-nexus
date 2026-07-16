import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth/session';
import { toFaucetRequestView, type FaucetRequestView } from '@/lib/faucet/dto';
import { FaucetClient } from './faucet-client';

export const metadata: Metadata = {
  title: 'Faucet — EVM Nexus',
};

export const dynamic = 'force-dynamic';

/**
 * /faucet (SPEC §7, §8.4) — request a native-token drip on the active network.
 * The active network's faucet ceiling + cooldown and the caller's recent
 * requests are loaded server-side; the interactive form + live log run in the
 * client manager against /api/faucet/*. The shared keypair table (#9) is only
 * placeheld here — this page does not own it.
 */
export default async function FaucetPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const network = await prisma.network.findFirst({ where: { isDefault: true } });

  const rows = await prisma.faucetRequest.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: {
      id: true,
      toAddress: true,
      amount: true,
      status: true,
      txHash: true,
      networkId: true,
      createdAt: true,
    },
  });
  const initialRequests: FaucetRequestView[] = rows.map(toFaucetRequestView);

  return (
    <div className="space-y-xl">
      <header className="space-y-1">
        <h1 className="display-lg text-on-surface">Faucet</h1>
        <p className="body-md text-on-surface-variant">
          Drip native gas tokens to any address on the active test chain. Rate-limited, capped, and
          logged.
        </p>
      </header>

      {network ? (
        <FaucetClient
          networkId={network.id}
          nativeSymbol={network.nativeSymbol}
          dripWei={network.faucetDripAmount}
          cooldownSec={network.faucetCooldownSec}
          initialRequests={initialRequests}
        />
      ) : (
        <p className="body-md text-on-surface-variant">
          No active network is configured. Ask an admin to set one in Network Settings.
        </p>
      )}
    </div>
  );
}

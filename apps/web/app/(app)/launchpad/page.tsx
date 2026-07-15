import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth/session';
import { toDeploymentView, type DeploymentView } from '@/lib/deployments/dto';
import { toKeypairDto, type KeypairDto } from '@/lib/keypairs/dto';
import { LaunchpadClient } from './launchpad-client';

export const metadata: Metadata = {
  title: 'Asset Launchpad — EVM Nexus',
};

export const dynamic = 'force-dynamic';

/**
 * /launchpad (SPEC §7, §8.5) — deploy ERC-20/721/1155 token contracts. The active
 * network + the caller's persisted keypairs + recent deployments load server-side;
 * the interactive tabs, estimate, client-side signing, and broadcast run in the
 * client manager against /api/deployments/*. The private key is decrypted and used
 * to sign ONLY in the browser (AGENT.md §0) — the server only ever receives a raw
 * signed tx.
 */
export default async function LaunchpadPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const network = await prisma.network.findFirst({ where: { isDefault: true } });

  const [keypairRows, deploymentRows] = await Promise.all([
    prisma.keypair.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.deployment.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
  ]);

  const keypairs: KeypairDto[] = keypairRows.map(toKeypairDto);
  const deployments: DeploymentView[] = deploymentRows.map(toDeploymentView);

  return (
    <div className="space-y-xl">
      <header className="space-y-1">
        <h1 className="display-lg text-on-surface">Asset Launchpad</h1>
        <p className="body-md text-on-surface-variant">
          Deploy ERC-20, ERC-721, and ERC-1155 contracts with opt-in features. Your keypair signs
          the deploy in-browser — the private key never touches the server.
        </p>
      </header>

      {network ? (
        <LaunchpadClient
          networkId={network.id}
          nativeSymbol={network.nativeSymbol}
          explorerBaseUrl={network.explorerBaseUrl}
          initialKeypairs={keypairs}
          initialDeployments={deployments}
        />
      ) : (
        <p className="body-md text-on-surface-variant">
          No active network is configured. Ask an admin to set one in Network Settings.
        </p>
      )}
    </div>
  );
}

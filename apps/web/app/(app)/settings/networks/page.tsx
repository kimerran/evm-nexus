import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { toNetworkDto } from '@/lib/chain/network-dto';
import { NetworksManager } from './networks-manager';

export const metadata: Metadata = {
  title: 'Network Settings — EVM Nexus',
};

export const dynamic = 'force-dynamic';

/**
 * Admin network configuration (SPEC §7 /settings/networks, §8.2). ADMIN-only —
 * the role is re-checked here server-side (the shell layout only guarantees a
 * session). Networks are loaded RPC-secret-REDACTED via {@link toNetworkDto} and
 * every mutation flows through the CSRF-protected, ADMIN-gated /api/networks.
 */
export default async function NetworkSettingsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.user.role !== 'ADMIN') redirect('/dashboard');

  const rows = await prisma.network.findMany({
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });
  const networks = rows.map(toNetworkDto);

  return (
    <div className="space-y-xl">
      <header className="space-y-1">
        <h1 className="display-lg text-on-surface">Network Settings</h1>
        <p className="body-md text-on-surface-variant">
          Configure the admin-approved chains. RPC credentials are encrypted at rest and never
          returned to the browser — only the active network drives on-chain reads and writes.
        </p>
      </header>

      <NetworksManager initialNetworks={networks} />
    </div>
  );
}

import type { Metadata } from 'next';
import { Card, Badge } from '@/components/ui';
import { prisma } from '@/lib/db';
import { decodeRpcUrlFromStorage } from '@/lib/chain/rpc-url';
import { buildPublicClient } from '@/lib/chain/resolver';
import { readNetworkHealth, type NetworkHealth } from '@/lib/chain/health';
import { DashboardLive } from './dashboard-live';
import { ConnectProvider } from './connect-provider';

export const metadata: Metadata = {
  title: 'Dashboard — EVM Nexus',
};

// Telemetry is live per-request; never statically cached.
export const dynamic = 'force-dynamic';

interface DashboardData {
  networkId: string | null;
  networkName: string;
  initialHealth: NetworkHealth | null;
  initialError: boolean;
  accounts: { users: number; keypairs: number; networks: number };
}

/** Load the server-rendered first paint: active network + initial health + counts. */
async function loadDashboard(): Promise<DashboardData> {
  const [network, users, keypairs, networks] = await Promise.all([
    prisma.network.findFirst({ where: { isDefault: true } }),
    prisma.user.count({ where: { isActive: true } }),
    prisma.keypair.count(),
    prisma.network.count(),
  ]);

  const accounts = { users, keypairs, networks };
  if (!network) {
    return { networkId: null, networkName: 'No network', initialHealth: null, initialError: true, accounts };
  }

  try {
    const client = buildPublicClient({
      chainId: network.chainId,
      name: network.name,
      rpcUrl: decodeRpcUrlFromStorage(network.rpcUrl),
      wsUrl: network.wsUrl,
      nativeSymbol: network.nativeSymbol,
      nativeDecimals: network.nativeDecimals,
      explorerBaseUrl: network.explorerBaseUrl,
    });
    const initialHealth = await readNetworkHealth(client);
    return { networkId: network.id, networkName: network.name, initialHealth, initialError: false, accounts };
  } catch {
    return { networkId: network.id, networkName: network.name, initialHealth: null, initialError: true, accounts };
  }
}

export default async function DashboardPage() {
  const { networkId, networkName, initialHealth, initialError, accounts } = await loadDashboard();

  return (
    <div className="space-y-xl">
      <header className="space-y-1">
        <h1 className="display-lg text-on-surface">Dashboard</h1>
        <p className="body-md text-on-surface-variant">
          Live network telemetry for the active test chain. Data is the hero.
        </p>
      </header>

      {/* Bento grid — 12 cols, gutter gap (BRAND §6.3). */}
      <div className="grid grid-cols-12 gap-gutter">
        {/* Live stat cards + event feed (client island; SSE with polling fallback). */}
        <DashboardLive
          networkId={networkId}
          networkName={networkName}
          initialHealth={initialHealth}
          initialError={initialError}
        />

        {/* Active accounts summary (server-rendered from the DB). */}
        <Card className="col-span-12 lg:col-span-8">
          <div className="mb-md flex items-center justify-between">
            <h2 className="headline-md text-on-surface">Active Accounts</h2>
            <Badge tone="count">{accounts.users + accounts.keypairs} Total</Badge>
          </div>
          <div className="grid grid-cols-3 gap-gutter">
            <SummaryStat label="Users" value={accounts.users} />
            <SummaryStat label="Keypairs" value={accounts.keypairs} />
            <SummaryStat label="Networks" value={accounts.networks} />
          </div>
        </Card>

        {/* Connect-provider card (client island). */}
        <ConnectProvider />
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-low p-md">
      <p className="label-caps text-on-surface-variant">{label}</p>
      <p className="mt-1 code-sm text-2xl font-bold text-primary">{value.toLocaleString('en-US')}</p>
    </div>
  );
}

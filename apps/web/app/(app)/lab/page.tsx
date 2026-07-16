import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth/session';
import { toTransferView, type TransferView } from '@/lib/transfers/dto';
import { toKeypairDto, type KeypairDto } from '@/lib/keypairs/dto';
import { LabShell } from './lab-shell';

export const metadata: Metadata = {
  title: 'Transaction Lab — EVM Nexus',
};

export const dynamic = 'force-dynamic';

/**
 * /lab (SPEC §7) — the Transaction Lab shell. A tabbed workspace (registry-driven)
 * with a Transfer Assets panel today and reserved slots for Bombard (#14) and
 * on-chain Chat (#15), plus a shared live tx feed over the #8 telemetry SSE
 * stream. The active network + keypairs + recent transfers load server-side; all
 * signing happens in-browser (AGENT.md §0) — the server only ever gets a raw
 * signed tx.
 */
export default async function LabPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const network = await prisma.network.findFirst({ where: { isDefault: true } });

  const [keypairRows, transferRows] = await Promise.all([
    prisma.keypair.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.transfer.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  const keypairs: KeypairDto[] = keypairRows.map(toKeypairDto);
  const transfers: TransferView[] = transferRows.map(toTransferView);

  return (
    <div className="space-y-xl">
      <header className="space-y-1">
        <h1 className="display-lg text-on-surface">Transaction Lab</h1>
        <p className="body-md text-on-surface-variant">
          A workspace for live on-chain experiments. Transfer assets today; Bombard and on-chain
          Chat land here next. Every transaction is signed in your browser.
        </p>
      </header>

      {network ? (
        <LabShell
          networkId={network.id}
          nativeSymbol={network.nativeSymbol}
          explorerBaseUrl={network.explorerBaseUrl}
          keypairs={keypairs}
          initialTransfers={transfers}
        />
      ) : (
        <p className="body-md text-on-surface-variant">
          No active network is configured. Ask an admin to set one in Network Settings.
        </p>
      )}
    </div>
  );
}

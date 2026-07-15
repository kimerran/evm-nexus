import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth/session';
import { toTransferView, type TransferView } from '@/lib/transfers/dto';
import { toKeypairDto, type KeypairDto } from '@/lib/keypairs/dto';
import { TransfersClient } from './transfers-client';

export const metadata: Metadata = {
  title: 'Transfers — EVM Nexus',
};

export const dynamic = 'force-dynamic';

/**
 * /transfers (SPEC §7, §8.6) — send native + ERC-20/721/1155 assets and review
 * history. The active network + the caller's keypairs + recent transfers load
 * server-side; the interactive form prepares/signs/broadcasts against
 * /api/transfers/*. The private key is decrypted and used to sign ONLY in the
 * browser (AGENT.md §0) — the server only ever receives a raw signed tx.
 */
export default async function TransfersPage() {
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
      take: 25,
    }),
  ]);

  const keypairs: KeypairDto[] = keypairRows.map(toKeypairDto);
  const transfers: TransferView[] = transferRows.map(toTransferView);

  return (
    <div className="space-y-xl">
      <header className="space-y-1">
        <h1 className="display-lg text-on-surface">Transfers</h1>
        <p className="body-md text-on-surface-variant">
          Send native coins and ERC-20/721/1155 assets. Your keypair signs the transfer in-browser
          — the private key never touches the server.
        </p>
      </header>

      {network ? (
        <TransfersClient
          networkId={network.id}
          nativeSymbol={network.nativeSymbol}
          explorerBaseUrl={network.explorerBaseUrl}
          initialKeypairs={keypairs}
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

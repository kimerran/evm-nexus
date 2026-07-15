import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth/session';
import { toKeypairDto, type KeypairDto } from '@/lib/keypairs/dto';
import { toSmartAccountView, type SmartAccountView } from '@/lib/smart-wallets/dto';
import { findStack } from '@/lib/smart-wallets/stack';
import { SmartWalletsClient } from './smart-wallets-client';

export const metadata: Metadata = {
  title: 'Smart Wallets — EVM Nexus',
};

export const dynamic = 'force-dynamic';

/**
 * /smart-wallets (SPEC §7, §8.9) — create ERC-4337 smart accounts, deploy them,
 * and send SPONSORED (gasless) UserOps where the paymaster pays gas and the owner
 * EOA pays nothing. The active network + the caller's keypairs + smart accounts
 * load server-side; the interactive client predicts/deploys/sends against
 * /api/smart-accounts/* and /api/userops/*. The owner key is decrypted and used to
 * sign the userOpHash ONLY in the browser (AGENT.md §0) — never on the server.
 */
export default async function SmartWalletsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const network = await prisma.network.findFirst({ where: { isDefault: true } });

  const [keypairRows, accountRows] = await Promise.all([
    prisma.keypair.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: 'desc' } }),
    network
      ? prisma.smartAccount.findMany({
          where: { userId: session.user.id, networkId: network.id },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
      : Promise.resolve([]),
  ]);

  const keypairs: KeypairDto[] = keypairRows.map(toKeypairDto);
  const accounts: SmartAccountView[] = accountRows.map(toSmartAccountView);
  const stack = network ? await findStack(network.id) : null;

  return (
    <div className="space-y-xl">
      <header className="space-y-1">
        <h1 className="display-lg text-on-surface">Smart Wallets</h1>
        <p className="body-md text-on-surface-variant">
          ERC-4337 smart accounts with gasless, paymaster-sponsored transactions. Your keypair is
          the account owner — it signs the UserOp in-browser; the paymaster pays the gas.
        </p>
      </header>

      {!network ? (
        <p className="body-md text-on-surface-variant">
          No active network is configured. Ask an admin to set one in Network Settings.
        </p>
      ) : !stack ? (
        <p className="body-md text-on-surface-variant">
          The ERC-4337 stack is not deployed on {network.name}. An operator must run{' '}
          <code className="code-sm">apps/web/scripts/deploy-4337.ts</code> first.
        </p>
      ) : (
        <SmartWalletsClient
          networkId={network.id}
          nativeSymbol={network.nativeSymbol}
          explorerBaseUrl={network.explorerBaseUrl}
          entryPoint={stack.entryPoint}
          paymaster={stack.paymaster}
          initialKeypairs={keypairs}
          initialAccounts={accounts}
        />
      )}
    </div>
  );
}

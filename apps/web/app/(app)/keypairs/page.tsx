import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { toKeypairDto } from '@/lib/keypairs/dto';
import { KeypairsManager } from './keypairs-manager';

export const metadata: Metadata = {
  title: 'Keypairs — EVM Nexus',
};

export const dynamic = 'force-dynamic';

/**
 * Non-custodial keypair vault (SPEC §4.1, §5, §8.3). Keys are generated,
 * encrypted, and unlocked ONLY in the browser (AGENT.md §0/§6). This server
 * component loads only the caller's PERSISTED rows — public address + label +
 * the opaque encrypted keystore blob the server cannot decrypt. There is no
 * plaintext key to load, anywhere.
 */
export default async function KeypairsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const rows = await prisma.keypair.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
  });
  const keypairs = rows.map(toKeypairDto);

  return (
    <div className="space-y-xl">
      <header className="space-y-1">
        <h1 className="display-lg text-on-surface">Keypairs</h1>
        <p className="body-md text-on-surface-variant">
          Non-custodial by design. Every private key is generated, encrypted, and unlocked in your
          browser — the server only ever holds the opaque encrypted keystore blob you choose to
          persist, and can never decrypt it or move your funds.
        </p>
      </header>

      <KeypairsManager initialKeypairs={keypairs} />
    </div>
  );
}

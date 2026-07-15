import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth/session';
import { toChatMessageView, type ChatMessageView } from '@/lib/chat/dto';
import { toKeypairDto, type KeypairDto } from '@/lib/keypairs/dto';
import { ChatPanel } from '@/components/chat/chat-panel';

export const metadata: Metadata = {
  title: 'On-chain Chat — EVM Nexus',
};

export const dynamic = 'force-dynamic';

/**
 * /chat (SPEC §8.8) — commit off-chain messages on-chain and verify them. Each
 * message stores a keccak256 contentHash; committing emits a ChatLog event, and
 * a per-message verify recomputes the hash and compares it to the on-chain value
 * (tamper-evidence). All signing happens in-browser (AGENT.md §0).
 */
export default async function ChatPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const network = await prisma.network.findFirst({ where: { isDefault: true } });

  const [keypairRows, messageRows] = await Promise.all([
    prisma.keypair.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: 'desc' } }),
    network
      ? prisma.chatMessage.findMany({
          where: { userId: session.user.id, networkId: network.id },
          orderBy: { createdAt: 'desc' },
          take: 25,
        })
      : Promise.resolve([]),
  ]);

  const keypairs: KeypairDto[] = keypairRows.map(toKeypairDto);
  const messages: ChatMessageView[] = messageRows.map(toChatMessageView);

  return (
    <div className="space-y-xl">
      <header className="space-y-1">
        <h1 className="display-lg text-on-surface">On-chain Chat</h1>
        <p className="body-md text-on-surface-variant">
          Messages live off-chain; a keccak256 hash of each is committed on-chain via ChatLog. Use
          Verify to prove a stored message matches its on-chain commitment.
        </p>
      </header>

      {network ? (
        <ChatPanel
          networkId={network.id}
          explorerBaseUrl={network.explorerBaseUrl}
          keypairs={keypairs}
          initialMessages={messages}
        />
      ) : (
        <p className="body-md text-on-surface-variant">
          No active network is configured. Ask an admin to set one in Network Settings.
        </p>
      )}
    </div>
  );
}

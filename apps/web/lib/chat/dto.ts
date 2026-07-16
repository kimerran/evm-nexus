// Serializable ChatMessage DTO shared by the API + the /chat & /lab pages
// (SPEC §8.8). Nothing secret is carried; the body is off-chain plaintext, the
// contentHash is the on-chain commitment.
import type { ChatMessage } from '@/lib/generated/prisma/client';

export interface ChatMessageView {
  id: string;
  body: string;
  contentHash: string;
  attachmentKey: string | null;
  senderAddress: string;
  txHash: string | null;
  status: string;
  networkId: string;
  createdAt: string;
}

export function toChatMessageView(row: ChatMessage): ChatMessageView {
  return {
    id: row.id,
    body: row.body,
    contentHash: row.contentHash,
    attachmentKey: row.attachmentKey,
    senderAddress: row.senderAddress,
    txHash: row.txHash,
    status: row.status,
    networkId: row.networkId,
    createdAt: row.createdAt.toISOString(),
  };
}

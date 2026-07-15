// GET /api/chat/:id/verify — tamper-evidence check (SPEC §8.8).
//
// Auth re-checked; scoped to the owner. Recomputes keccak256 of the STORED body
// (+ attachment key) and compares it to the `contentHash` in the on-chain
// `MessageCommitted` event of the commit tx. A match → the stored content is
// exactly what was committed (verified). A mismatch → the stored body was altered
// after commit (tampered). Read-only; never signs.
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { jsonOk, toErrorResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { getPublicClient } from '@/lib/chain/resolver';
import { computeContentHash, getChatLogAddress } from '@/lib/chat/chatlog';
import { readCommittedHash } from '@/lib/chat/onchain';
import type { Hex } from 'viem';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireAuth(req);
    const { id } = await ctx.params;

    const message = await prisma.chatMessage.findUnique({ where: { id } });
    if (!message || message.userId !== principal.user.id) {
      throw new NotFoundError('Chat message not found.');
    }
    if (!message.txHash) {
      throw new ValidationError('This message has not been committed on-chain yet.');
    }

    const chatLogAddress = await getChatLogAddress(message.networkId);
    if (!chatLogAddress) {
      throw new ValidationError('ChatLog is not deployed on this network.');
    }

    const publicClient = await getPublicClient();
    const onchain = await readCommittedHash(publicClient, message.txHash as Hex, chatLogAddress);
    if (!onchain) {
      return jsonOk({
        verified: false,
        reason: 'no-onchain-event',
        onchainHash: null,
        localHash: message.contentHash,
        txHash: message.txHash,
      });
    }

    const recomputed = computeContentHash(message.body, message.attachmentKey);
    const verified = recomputed.toLowerCase() === onchain.contentHash.toLowerCase();

    return jsonOk({
      verified,
      onchainHash: onchain.contentHash,
      localHash: recomputed,
      storedHash: message.contentHash,
      sender: onchain.sender,
      txHash: message.txHash,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

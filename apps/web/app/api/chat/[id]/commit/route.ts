// POST /api/chat/:id/commit — commit a message hash on-chain (SPEC §8.8/§9).
//
// Two paths (AGENT.md §0):
//   • client-signed: the server receives ONLY a raw SIGNED tx. It decodes the
//     HMAC draft, confirms ownership + that the draft is for THIS message,
//     independently verifies the signed tx (to == ChatLog, value == 0, data ==
//     pinned commit calldata, chainId, ceilings, signer == from), broadcasts,
//     records txHash, and enqueues the shared tx-watch for the receipt.
//   • relayer: the budget-capped ALTERNATIVE — no signed tx; the operator key
//     (worker-only) signs + broadcasts. Here we just enqueue the chat-commit job.
// Both audit-log the commit. Auth + CSRF + rate-limit enforced.
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { jsonOk, toErrorResponse, getClientIp } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { requireCsrfUnlessApiKey } from '@/lib/auth/mutation-guard';
import { ValidationError, ForbiddenError, NotFoundError, RateLimitError, ConflictError } from '@/lib/errors';
import { RATE_LIMITS, consumeRateLimit, rateLimitKey } from '@/lib/rate-limit';
import { writeAudit } from '@/lib/audit';
import { getPublicClient } from '@/lib/chain/resolver';
import { chatCommitSchema } from '@/lib/chat/schema';
import { decodeChatDraft } from '@/lib/chat/draft';
import { resolveActiveChatNetwork } from '@/lib/chat/context';
import { loadChatCeilings } from '@/lib/chat/ceilings';
import { parseSignedCommit, assertCommitWithinPolicy } from '@/lib/chat/verify';
import { enqueueChatCommitWatch } from '@/lib/queue/tx-queue';
import { enqueueChatCommit } from '@/lib/queue/chat-queue';

export const dynamic = 'force-dynamic';

const DRAFT_ERROR_MESSAGE: Record<string, string> = {
  malformed: 'Malformed commit draft.',
  'bad-signature': 'Commit draft failed verification.',
  expired: 'Commit draft has expired — re-send the message and try again.',
};

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireAuth(req);
    requireCsrfUnlessApiKey(req);
    const { id } = await ctx.params;

    const ip = getClientIp(req);
    const rl = await consumeRateLimit(
      rateLimitKey('chat', 'user', principal.user.id),
      RATE_LIMITS.chat,
    );
    if (!rl.allowed) throw new RateLimitError(rl.retryAfterSec, 'Too many chat requests.');

    const body: unknown = await req.json().catch(() => null);
    const parsedBody = chatCommitSchema.safeParse(body);
    if (!parsedBody.success) {
      throw new ValidationError(parsedBody.error.issues[0]?.message ?? 'Invalid request body.');
    }
    const input = parsedBody.data;

    const message = await prisma.chatMessage.findUnique({ where: { id } });
    if (!message || message.userId !== principal.user.id) {
      throw new NotFoundError('Chat message not found.');
    }
    if (message.txHash) {
      throw new ConflictError('This message has already been committed.');
    }

    // --- Relayer path (budget-capped; operator key lives only in the worker) ---
    if (input.mode === 'relayer') {
      await enqueueChatCommit(message.id);
      await writeAudit({
        actorId: principal.user.id,
        action: 'chat.commit.relayer',
        target: { type: 'ChatMessage', id: message.id },
        metadata: { networkId: message.networkId, mode: 'relayer' },
        ip,
      });
      return jsonOk({ messageId: message.id, mode: 'relayer', status: 'QUEUED' }, { status: 202 });
    }

    // --- Client-signed path ---
    const decoded = decodeChatDraft(input.commitDraftId);
    if (!decoded.ok) {
      throw new ValidationError(DRAFT_ERROR_MESSAGE[decoded.error] ?? 'Invalid commit draft.');
    }
    const draft = decoded.draft;
    if (draft.userId !== principal.user.id) {
      throw new ForbiddenError('This commit draft belongs to another user.');
    }
    if (draft.messageId !== message.id) {
      throw new ValidationError('Commit draft does not match this message.');
    }

    const network = await resolveActiveChatNetwork(draft.networkId);
    if (network.id !== draft.networkId || network.chainId !== draft.chainId) {
      throw new ValidationError('The commit draft targets a network that is no longer active.');
    }

    const ceilings = await loadChatCeilings();

    const publicClient = await getPublicClient();
    const liveChainId = await publicClient.getChainId();
    if (liveChainId !== network.chainId) {
      throw new ValidationError(
        `Active network chainId ${network.chainId} does not match the live RPC (${liveChainId}).`,
      );
    }

    const parsedTx = await parseSignedCommit(input.rawSignedTx);
    assertCommitWithinPolicy(parsedTx, { draft, activeChainId: liveChainId, ceilings });

    const txHash = await publicClient.sendRawTransaction({
      serializedTransaction: input.rawSignedTx as `0x${string}`,
    });

    await prisma.chatMessage.update({
      where: { id: message.id },
      data: { txHash, status: 'BROADCAST' },
    });

    await enqueueChatCommitWatch(message.id);

    await writeAudit({
      actorId: principal.user.id,
      action: 'chat.commit',
      target: { type: 'ChatMessage', id: message.id },
      metadata: {
        networkId: network.id,
        chainId: network.chainId,
        contentHash: draft.contentHash,
        sender: draft.from,
        txHash,
      },
      ip,
    });

    return jsonOk({ messageId: message.id, txHash, status: 'BROADCAST' }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

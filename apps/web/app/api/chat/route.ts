// GET /api/chat — the caller's own chat messages (SPEC §8.8).
// POST /api/chat — store a message off-chain + build its unsigned commit tx.
//
// Auth + (on POST) CSRF + rate-limit re-checked here. POST computes keccak256
// (viem) of the body (+ attachment key), persists a PENDING ChatMessage, and
// returns the unsigned `ChatLog.commit` tx + an HMAC draft pinning every
// security-relevant value for `/commit` to verify against. The private key never
// comes near the server — the CLIENT signs.
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { jsonOk, toErrorResponse, getClientIp } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { requireCsrfUnlessApiKey } from '@/lib/auth/mutation-guard';
import { ValidationError, RateLimitError } from '@/lib/errors';
import { RATE_LIMITS, consumeRateLimit, rateLimitKey } from '@/lib/rate-limit';
import { getPublicClient } from '@/lib/chain/resolver';
import { chatCreateSchema } from '@/lib/chat/schema';
import { resolveActiveChatNetwork } from '@/lib/chat/context';
import { loadChatCeilings } from '@/lib/chat/ceilings';
import {
  computeContentHash,
  buildCommitCalldata,
  getChatLogAddress,
} from '@/lib/chat/chatlog';
import { encodeChatDraft, CHAT_DRAFT_TTL_MS, type ChatCommitDraft } from '@/lib/chat/draft';
import { toChatMessageView } from '@/lib/chat/dto';
import type { Prisma } from '@/lib/generated/prisma/client';
import type { Hex } from 'viem';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  try {
    const principal = await requireAuth(req);
    const params = new URL(req.url).searchParams;

    const where: Prisma.ChatMessageWhereInput = { userId: principal.user.id };
    const networkId = params.get('networkId');
    if (networkId) where.networkId = networkId;

    const rawLimit = Number(params.get('limit') ?? '50');
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), MAX_LIMIT) : 50;

    const rows = await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return jsonOk({ messages: rows.map(toChatMessageView) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const principal = await requireAuth(req);
    requireCsrfUnlessApiKey(req);

    const ip = getClientIp(req);
    const results = await Promise.all([
      consumeRateLimit(rateLimitKey('chat', 'user', principal.user.id), RATE_LIMITS.chat),
      consumeRateLimit(rateLimitKey('chat', 'ip', ip), RATE_LIMITS.chat),
    ]);
    const blocked = results.find((r) => !r.allowed);
    if (blocked) throw new RateLimitError(blocked.retryAfterSec, 'Too many chat requests.');

    const body: unknown = await req.json().catch(() => null);
    const parsed = chatCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
    }
    const request = parsed.data;

    const network = await resolveActiveChatNetwork(request.networkId);
    const ceilings = await loadChatCeilings();
    if (!ceilings.enabled) throw new ValidationError('On-chain chat is currently disabled.');

    const chatLogAddress = await getChatLogAddress(network.id);
    if (!chatLogAddress) {
      throw new ValidationError('ChatLog is not deployed on the active network yet.');
    }

    const attachmentKey = request.attachmentKey ?? null;
    const contentHash = computeContentHash(request.body, attachmentKey);

    // Persist off-chain FIRST so we have a message id to use as the commit `ref`.
    const message = await prisma.chatMessage.create({
      data: {
        userId: principal.user.id,
        networkId: network.id,
        body: request.body,
        contentHash,
        attachmentKey,
        senderAddress: request.from,
        status: 'PENDING',
      },
      select: { id: true },
    });

    const data = buildCommitCalldata(contentHash, message.id);

    const publicClient = await getPublicClient();
    const liveChainId = await publicClient.getChainId();
    if (liveChainId !== network.chainId) {
      throw new ValidationError(
        `Active network chainId ${network.chainId} does not match the live RPC (${liveChainId}).`,
      );
    }

    const rawGas = await publicClient.estimateGas({
      account: request.from as Hex,
      to: chatLogAddress as Hex,
      value: 0n,
      data,
    });
    const estimatedGas = (rawGas * 12n) / 10n;

    const block = await publicClient.getBlock({ blockTag: 'latest' });
    const baseFee = block.baseFeePerGas ?? 0n;
    let maxPriorityFeePerGas: bigint;
    try {
      maxPriorityFeePerGas = await publicClient.estimateMaxPriorityFeePerGas();
    } catch {
      maxPriorityFeePerGas = 1_000_000_000n;
    }
    const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;

    const nonce = await publicClient.getTransactionCount({ address: request.from as Hex });

    const draft: ChatCommitDraft = {
      v: 1,
      userId: principal.user.id,
      networkId: network.id,
      chainId: network.chainId,
      messageId: message.id,
      contentHash,
      from: request.from,
      txTo: chatLogAddress,
      txValue: '0',
      data,
      maxGas: ceilings.maxGas.toString(),
      maxFeePerGasWei: ceilings.maxFeePerGasWei.toString(),
      exp: Date.now() + CHAT_DRAFT_TTL_MS,
    };
    const commitDraftId = encodeChatDraft(draft);

    const row = await prisma.chatMessage.findUniqueOrThrow({ where: { id: message.id } });

    return jsonOk(
      {
        messageId: message.id,
        contentHash,
        message: toChatMessageView(row),
        commitDraftId,
        unsignedCommitTx: {
          type: 'eip1559',
          chainId: network.chainId,
          nonce,
          to: chatLogAddress,
          value: '0',
          data,
          gas: estimatedGas.toString(),
          maxFeePerGas: maxFeePerGas.toString(),
          maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

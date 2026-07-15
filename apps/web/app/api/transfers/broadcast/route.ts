// POST /api/transfers/broadcast — verify + broadcast a client-SIGNED transfer tx
// (SPEC §8.6, AGENT.md §0/§5).
//
// Auth + CSRF re-checked here. The server receives ONLY a raw SIGNED tx — never a
// private key. Before it touches the chain it independently proves the signature
// covers exactly what /prepare authorized: it decodes the signed draft (HMAC),
// confirms the caller owns it, then verifies the parsed signed tx has a `to`
// equal to the pinned target, a `value` equal to the pinned amount, calldata
// equal to the pinned transfer args, a chainId equal to BOTH the pinned draft
// chainId AND the LIVE active network, and gas/value/fee within the ceilings.
// Only then does it broadcast, persist a Transfer (PENDING), enqueue tx-watch,
// publish a live tx event, and audit-log the transfer.
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { jsonOk, toErrorResponse, getClientIp } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { requireCsrfUnlessApiKey } from '@/lib/auth/mutation-guard';
import { ValidationError, ForbiddenError, RateLimitError } from '@/lib/errors';
import { RATE_LIMITS, consumeRateLimit, rateLimitKey } from '@/lib/rate-limit';
import { writeAudit } from '@/lib/audit';
import { getPublicClient } from '@/lib/chain/resolver';
import { publishTxEvent } from '@/lib/telemetry/publish';
import { transferBroadcastSchema } from '@/lib/transfers/schema';
import { decodeDraft } from '@/lib/transfers/draft';
import { resolveActiveTransferNetwork } from '@/lib/transfers/context';
import { loadTransferCeilings } from '@/lib/transfers/ceilings';
import { parseSignedTransfer, assertTransferWithinPolicy } from '@/lib/transfers/verify';
import { enqueueTxWatch } from '@/lib/queue/tx-queue';
import type { TransferKind } from '@/lib/generated/prisma/enums';

export const dynamic = 'force-dynamic';

const DRAFT_ERROR_MESSAGE: Record<string, string> = {
  malformed: 'Malformed transfer draft.',
  'bad-signature': 'Transfer draft failed verification.',
  expired: 'Transfer draft has expired — re-prepare and try again.',
};

export async function POST(req: NextRequest) {
  try {
    const principal = await requireAuth(req);
    requireCsrfUnlessApiKey(req);

    const ip = getClientIp(req);
    const rl = await consumeRateLimit(
      rateLimitKey('transfer', 'user', principal.user.id),
      RATE_LIMITS.transfer,
    );
    if (!rl.allowed) throw new RateLimitError(rl.retryAfterSec, 'Too many transfer requests.');

    const body: unknown = await req.json().catch(() => null);
    const parsedBody = transferBroadcastSchema.safeParse(body);
    if (!parsedBody.success) {
      throw new ValidationError(parsedBody.error.issues[0]?.message ?? 'Invalid request body.');
    }
    const { transferDraftId, rawSignedTx, networkId } = parsedBody.data;

    // Decode + verify the signed draft (integrity, expiry).
    const decoded = decodeDraft(transferDraftId);
    if (!decoded.ok) {
      throw new ValidationError(DRAFT_ERROR_MESSAGE[decoded.error] ?? 'Invalid transfer draft.');
    }
    const draft = decoded.draft;
    if (draft.userId !== principal.user.id) {
      throw new ForbiddenError('This transfer draft belongs to another user.');
    }

    // The pinned network must still be the active one.
    const network = await resolveActiveTransferNetwork(networkId ?? draft.networkId);
    if (network.id !== draft.networkId || network.chainId !== draft.chainId) {
      throw new ValidationError('The transfer draft targets a network that is no longer active.');
    }

    const ceilings = await loadTransferCeilings();

    // Confirm the live chain matches the configured one BEFORE any broadcast.
    const publicClient = await getPublicClient();
    const liveChainId = await publicClient.getChainId();
    if (liveChainId !== network.chainId) {
      throw new ValidationError(
        `Active network chainId ${network.chainId} does not match the live RPC (${liveChainId}).`,
      );
    }

    // Independently verify the SIGNED tx against exactly what we authorized.
    const parsedTx = await parseSignedTransfer(rawSignedTx);
    assertTransferWithinPolicy(parsedTx, { draft, activeChainId: liveChainId, ceilings });

    // Broadcast the raw signed tx (only tx HASHES are ever logged, never the raw tx).
    const txHash = await publicClient.sendRawTransaction({
      serializedTransaction: rawSignedTx as `0x${string}`,
    });

    const transfer = await prisma.transfer.create({
      data: {
        userId: principal.user.id,
        networkId: network.id,
        kind: draft.kind as TransferKind,
        fromAddress: draft.from,
        toAddress: draft.to,
        tokenAddress: draft.tokenAddress,
        tokenId: draft.tokenId,
        amount: draft.amount,
        sponsored: false,
        txHash,
        status: 'PENDING',
      },
      select: { id: true },
    });

    await enqueueTxWatch(transfer.id);

    await publishTxEvent({
      id: transfer.id,
      kind: draft.kind,
      status: 'PENDING',
      fromAddress: draft.from,
      toAddress: draft.to,
      tokenAddress: draft.tokenAddress,
      tokenId: draft.tokenId,
      amount: draft.amount,
      txHash,
      at: new Date().toISOString(),
    });

    await writeAudit({
      actorId: principal.user.id,
      action: `transfer.${draft.kind.toLowerCase()}`,
      target: { type: 'Transfer', id: transfer.id },
      metadata: {
        networkId: network.id,
        chainId: network.chainId,
        kind: draft.kind,
        from: draft.from,
        to: draft.to,
        tokenAddress: draft.tokenAddress,
        tokenId: draft.tokenId,
        amount: draft.amount,
        txHash,
      },
      ip,
    });

    return jsonOk({ transferId: transfer.id, txHash, status: 'PENDING' }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

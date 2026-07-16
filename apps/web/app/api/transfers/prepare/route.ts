// POST /api/transfers/prepare — build the UNSIGNED transfer tx (SPEC §8.6, AGENT.md §4/§5).
//
// Auth + CSRF re-checked here. zod-validates the transfer request, resolves the
// on-chain call (native value / ERC20 transfer / ERC721|1155 safeTransferFrom)
// against the COMMITTED token ABIs (#11) via viem, estimates gas + reads fees, and
// returns the unsigned tx for the CLIENT to sign. The private key never comes near
// the server. A signed, opaque draft token pins every security-relevant value
// (network/chainId/to/value/data/ceilings/sender) so /broadcast can validate the
// signed tx against exactly what we authorized.
//
// Sponsored (paymaster) transfers land in Sprint 8: the toggle is wired end-to-end
// but `sponsored:true` returns a typed `mode: 'sponsored-unavailable'` marker
// rather than a UserOp, so the UI can surface it without a broken flow.
import type { NextRequest } from 'next/server';
import { jsonOk, toErrorResponse, getClientIp } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { requireCsrfUnlessApiKey } from '@/lib/auth/mutation-guard';
import { ValidationError, RateLimitError } from '@/lib/errors';
import { RATE_LIMITS, consumeRateLimit, rateLimitKey } from '@/lib/rate-limit';
import { getPublicClient } from '@/lib/chain/resolver';
import { transferPrepareSchema } from '@/lib/transfers/schema';
import { buildTransferCall } from '@/lib/transfers/calldata';
import { resolveActiveTransferNetwork } from '@/lib/transfers/context';
import { loadTransferCeilings } from '@/lib/transfers/ceilings';
import { encodeDraft, DRAFT_TTL_MS, type TransferDraft } from '@/lib/transfers/draft';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const principal = await requireAuth(req);
    requireCsrfUnlessApiKey(req);

    const results = await Promise.all([
      consumeRateLimit(rateLimitKey('transfer', 'user', principal.user.id), RATE_LIMITS.transfer),
      consumeRateLimit(rateLimitKey('transfer', 'ip', getClientIp(req)), RATE_LIMITS.transfer),
    ]);
    const blocked = results.find((r) => !r.allowed);
    if (blocked) throw new RateLimitError(blocked.retryAfterSec, 'Too many transfer requests.');

    const body: unknown = await req.json().catch(() => null);
    const parsed = transferPrepareSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
    }
    const request = parsed.data;

    const network = await resolveActiveTransferNetwork(request.networkId);
    const ceilings = await loadTransferCeilings();
    if (!ceilings.enabled) throw new ValidationError('Transfers are currently disabled.');

    // Sponsored branch: the paymaster/UserOp path now lives at /api/userops/*
    // (#16). The client sends a sponsored NATIVE transfer through the keypair's
    // smart account there — never as a client-signed EOA tx here. This guard keeps
    // /prepare from silently downgrading a sponsored request to an unsponsored EOA
    // send; the UI branches to the sponsored flow before ever calling /prepare.
    if (request.sponsored) {
      return jsonOk({
        mode: 'sponsored-unavailable' as const,
        sprint: 16,
        message: 'Sponsored transfers use the smart-account flow — see /api/userops/sponsor.',
      });
    }

    const call = buildTransferCall(request);

    const publicClient = await getPublicClient();
    const liveChainId = await publicClient.getChainId();
    if (liveChainId !== network.chainId) {
      throw new ValidationError(
        `Active network chainId ${network.chainId} does not match the live RPC (${liveChainId}).`,
      );
    }

    // Gas + fee estimation. A 20% buffer absorbs receiver-hook variance so the
    // client's signed gasLimit won't out-of-gas; the ceiling still bounds it.
    const rawGas = await publicClient.estimateGas({
      account: request.from as `0x${string}`,
      to: call.to as `0x${string}`,
      value: call.value,
      data: call.data,
    });
    const estimatedGas = (rawGas * 12n) / 10n;

    const block = await publicClient.getBlock({ blockTag: 'latest' });
    const baseFee = block.baseFeePerGas ?? 0n;
    let maxPriorityFeePerGas: bigint;
    try {
      maxPriorityFeePerGas = await publicClient.estimateMaxPriorityFeePerGas();
    } catch {
      maxPriorityFeePerGas = 1_000_000_000n; // 1 gwei fallback
    }
    const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;

    const nonce = await publicClient.getTransactionCount({
      address: request.from as `0x${string}`,
    });

    const draft: TransferDraft = {
      v: 1,
      userId: principal.user.id,
      networkId: network.id,
      chainId: network.chainId,
      kind: request.kind,
      from: request.from,
      to: request.to,
      tokenAddress: request.kind === 'NATIVE' ? null : request.tokenAddress,
      tokenId:
        request.kind === 'ERC721' || request.kind === 'ERC1155' ? request.tokenId : null,
      amount: request.kind === 'ERC721' ? null : request.amount,
      txTo: call.to,
      txValue: call.value.toString(),
      data: call.data,
      maxGas: ceilings.maxGas.toString(),
      maxValueWei: ceilings.maxValueWei.toString(),
      maxFeePerGasWei: ceilings.maxFeePerGasWei.toString(),
      exp: Date.now() + DRAFT_TTL_MS,
    };
    const transferDraftId = encodeDraft(draft);

    return jsonOk({
      mode: 'client-signed' as const,
      estimatedGas: estimatedGas.toString(),
      baseFee: baseFee.toString(),
      transferDraftId,
      unsignedTx: {
        type: 'eip1559',
        chainId: network.chainId,
        nonce,
        to: call.to,
        value: call.value.toString(),
        data: call.data,
        gas: estimatedGas.toString(),
        maxFeePerGas: maxFeePerGas.toString(),
        maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

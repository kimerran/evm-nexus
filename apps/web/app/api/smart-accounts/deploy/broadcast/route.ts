// POST /api/smart-accounts/deploy/broadcast — verify + broadcast a client-SIGNED
// factory-create tx (SPEC §8.9, AGENT.md §5).
//
// Auth + CSRF re-checked here. The server receives ONLY a raw SIGNED tx — never a
// private key. It decodes the HMAC deploy draft, confirms the caller owns it, then
// independently verifies the parsed signed tx has a `to` equal to the pinned
// factory, a zero `value`, calldata equal to the pinned createAccount args, a
// chainId equal to BOTH the pinned draft AND the LIVE active network, gas/fee
// within ceilings, and a signer equal to the pinned owner. Only then does it
// broadcast. `isDeployed` reconciles against on-chain code on the next read.
import type { NextRequest } from 'next/server';
import { getAddress } from 'viem';
import { prisma } from '@/lib/db';
import { jsonOk, toErrorResponse, getClientIp } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { requireCsrfUnlessApiKey } from '@/lib/auth/mutation-guard';
import { ValidationError, ForbiddenError, RateLimitError } from '@/lib/errors';
import { RATE_LIMITS, consumeRateLimit, rateLimitKey } from '@/lib/rate-limit';
import { writeAudit } from '@/lib/audit';
import { getPublicClient } from '@/lib/chain/resolver';
import { parseSignedTransfer } from '@/lib/transfers/verify';
import { deployBroadcastSchema } from '@/lib/smart-wallets/schema';
import { resolveActiveSmartWalletNetwork } from '@/lib/smart-wallets/context';
import { decodeDeployDraft } from '@/lib/smart-wallets/draft';

export const dynamic = 'force-dynamic';

const DRAFT_ERROR_MESSAGE: Record<string, string> = {
  malformed: 'Malformed deploy draft.',
  'bad-signature': 'Deploy draft failed verification.',
  expired: 'Deploy draft has expired — re-prepare and try again.',
};

export async function POST(req: NextRequest) {
  try {
    const principal = await requireAuth(req);
    requireCsrfUnlessApiKey(req);
    const ip = getClientIp(req);

    const rl = await consumeRateLimit(
      rateLimitKey('userops', 'user', principal.user.id),
      RATE_LIMITS.userops,
    );
    if (!rl.allowed) throw new RateLimitError(rl.retryAfterSec, 'Too many requests.');

    const body: unknown = await req.json().catch(() => null);
    const parsedBody = deployBroadcastSchema.safeParse(body);
    if (!parsedBody.success) {
      throw new ValidationError(parsedBody.error.issues[0]?.message ?? 'Invalid request body.');
    }
    const { deployDraftId, rawSignedTx, networkId } = parsedBody.data;

    const decoded = decodeDeployDraft(deployDraftId);
    if (!decoded.ok) {
      throw new ValidationError(DRAFT_ERROR_MESSAGE[decoded.error] ?? 'Invalid deploy draft.');
    }
    const draft = decoded.draft;
    if (draft.userId !== principal.user.id) {
      throw new ForbiddenError('This deploy draft belongs to another user.');
    }

    const network = await resolveActiveSmartWalletNetwork(networkId ?? draft.networkId);
    if (network.id !== draft.networkId || network.chainId !== draft.chainId) {
      throw new ValidationError('The deploy draft targets a network that is no longer active.');
    }

    const publicClient = await getPublicClient();
    const liveChainId = await publicClient.getChainId();
    if (liveChainId !== network.chainId) {
      throw new ValidationError(
        `Active network chainId ${network.chainId} does not match the live RPC (${liveChainId}).`,
      );
    }

    // Independently verify the SIGNED tx against exactly what /deploy pinned.
    const parsed = await parseSignedTransfer(rawSignedTx);
    if (parsed.to === null || getAddress(parsed.to) !== getAddress(draft.txTo)) {
      throw new ValidationError('Signed tx `to` does not match the authorized factory.');
    }
    if (parsed.value !== 0n) {
      throw new ValidationError('A create-account tx must not transfer value.');
    }
    if (parsed.data.toLowerCase() !== draft.data.toLowerCase()) {
      throw new ValidationError('Signed tx data does not match the authorized createAccount call.');
    }
    if (parsed.chainId !== draft.chainId || parsed.chainId !== liveChainId) {
      throw new ValidationError(`chainId mismatch: signed ${parsed.chainId} != active ${liveChainId}.`);
    }
    if (parsed.gas > BigInt(draft.maxGas)) {
      throw new ValidationError(`gas limit ${parsed.gas} exceeds ceiling ${draft.maxGas}.`);
    }
    if (parsed.maxFeePerGas > BigInt(draft.maxFeePerGasWei)) {
      throw new ValidationError(`maxFeePerGas ${parsed.maxFeePerGas} exceeds ceiling ${draft.maxFeePerGasWei}.`);
    }
    if (getAddress(parsed.from) !== getAddress(draft.ownerAddress)) {
      throw new ValidationError('Signed tx signer does not match the account owner.');
    }

    const txHash = await publicClient.sendRawTransaction({
      serializedTransaction: rawSignedTx as `0x${string}`,
    });

    await prisma.smartAccount.upsert({
      where: {
        networkId_accountAddress: { networkId: network.id, accountAddress: draft.accountAddress },
      },
      create: {
        userId: principal.user.id,
        ownerAddress: draft.ownerAddress,
        accountAddress: draft.accountAddress,
        networkId: network.id,
        factory: draft.factory,
        isDeployed: false,
      },
      update: {},
    });

    await writeAudit({
      actorId: principal.user.id,
      action: 'smartaccount.deploy',
      target: { type: 'SmartAccount', id: draft.accountAddress },
      metadata: {
        networkId: network.id,
        chainId: network.chainId,
        ownerAddress: draft.ownerAddress,
        accountAddress: draft.accountAddress,
        factory: draft.factory,
        txHash,
      },
      ip,
    });

    return jsonOk({ accountAddress: draft.accountAddress, txHash, status: 'PENDING' }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

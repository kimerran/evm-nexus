// POST /api/deployments/broadcast — verify + broadcast a client-SIGNED deploy tx
// (SPEC §8.5, AGENT.md §0/§5).
//
// Auth + CSRF re-checked here. The server receives ONLY a raw SIGNED tx — never a
// private key. Before it touches the chain it independently proves the signature
// covers exactly what /estimate authorized: it decodes the signed draft (HMAC),
// confirms the caller owns it, then verifies the parsed signed tx is a contract
// creation whose chainId equals BOTH the pinned draft chainId AND the LIVE active
// network, whose calldata equals the pinned bytecode+ctor-args, and whose
// gas/value/fee stay within the ceilings. Only then does it broadcast via the
// resolver's client, persist a Deployment, and enqueue deploy-watch.
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { jsonOk, toErrorResponse, getClientIp } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { requireCsrfUnlessApiKey } from '@/lib/auth/mutation-guard';
import { ValidationError, ForbiddenError, RateLimitError } from '@/lib/errors';
import { RATE_LIMITS, consumeRateLimit, rateLimitKey } from '@/lib/rate-limit';
import { writeAudit } from '@/lib/audit';
import { getPublicClient } from '@/lib/chain/resolver';
import { deployBroadcastSchema } from '@/lib/deployments/schema';
import { decodeDraft } from '@/lib/deployments/draft';
import { resolveActiveDeployNetwork } from '@/lib/deployments/context';
import { loadDeployCeilings } from '@/lib/deployments/ceilings';
import { parseSignedDeploy, assertDeployWithinPolicy } from '@/lib/deployments/verify';
import { enqueueDeployWatch } from '@/lib/queue/deploy-queue';
import type { TokenStandard } from '@/lib/generated/prisma/enums';

export const dynamic = 'force-dynamic';

const DRAFT_ERROR_MESSAGE: Record<string, string> = {
  malformed: 'Malformed deployment draft.',
  'bad-signature': 'Deployment draft failed verification.',
  expired: 'Deployment draft has expired — re-estimate and try again.',
};

export async function POST(req: NextRequest) {
  try {
    const principal = await requireAuth(req);
    requireCsrfUnlessApiKey(req);

    const ip = getClientIp(req);
    const rl = await consumeRateLimit(
      rateLimitKey('deploy', 'user', principal.user.id),
      RATE_LIMITS.deploy,
    );
    if (!rl.allowed) throw new RateLimitError(rl.retryAfterSec, 'Too many deploy requests.');

    const body: unknown = await req.json().catch(() => null);
    const parsedBody = deployBroadcastSchema.safeParse(body);
    if (!parsedBody.success) {
      throw new ValidationError(parsedBody.error.issues[0]?.message ?? 'Invalid request body.');
    }
    const { deploymentDraftId, rawSignedTx, networkId } = parsedBody.data;

    // Decode + verify the signed draft (integrity, expiry).
    const decoded = decodeDraft(deploymentDraftId);
    if (!decoded.ok) {
      throw new ValidationError(DRAFT_ERROR_MESSAGE[decoded.error] ?? 'Invalid deployment draft.');
    }
    const draft = decoded.draft;
    if (draft.userId !== principal.user.id) {
      throw new ForbiddenError('This deployment draft belongs to another user.');
    }

    // The pinned network must still be the active one.
    const network = await resolveActiveDeployNetwork(networkId ?? draft.networkId);
    if (network.id !== draft.networkId || network.chainId !== draft.chainId) {
      throw new ValidationError('The deployment draft targets a network that is no longer active.');
    }

    const ceilings = await loadDeployCeilings();

    // Confirm the live chain matches the configured one BEFORE any broadcast.
    const publicClient = await getPublicClient();
    const liveChainId = await publicClient.getChainId();
    if (liveChainId !== network.chainId) {
      throw new ValidationError(
        `Active network chainId ${network.chainId} does not match the live RPC (${liveChainId}).`,
      );
    }

    // Independently verify the SIGNED tx against exactly what we authorized.
    const parsedTx = await parseSignedDeploy(rawSignedTx);
    assertDeployWithinPolicy(parsedTx, { draft, activeChainId: liveChainId, ceilings });

    // Broadcast the raw signed tx (only tx HASHES are ever logged, never the raw tx).
    const txHash = await publicClient.sendRawTransaction({
      serializedTransaction: rawSignedTx as `0x${string}`,
    });

    const deployment = await prisma.deployment.create({
      data: {
        userId: principal.user.id,
        networkId: network.id,
        standard: draft.standard as TokenStandard,
        name: draft.name || draft.standard,
        symbol: draft.symbol,
        features: draft.features,
        initialSupply: draft.initialSupply,
        baseUri: draft.baseUri,
        txHash,
        status: 'PENDING',
      },
      select: { id: true },
    });

    await enqueueDeployWatch(deployment.id);

    await writeAudit({
      actorId: principal.user.id,
      action: `deploy.${draft.standard.toLowerCase()}`,
      target: { type: 'Deployment', id: deployment.id },
      metadata: {
        networkId: network.id,
        chainId: network.chainId,
        standard: draft.standard,
        contractName: draft.contractName,
        owner: draft.ownerAddress,
        txHash,
      },
      ip,
    });

    return jsonOk(
      { deploymentId: deployment.id, txHash, status: 'PENDING' },
      { status: 202 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

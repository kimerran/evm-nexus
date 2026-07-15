// POST /api/deployments/estimate — build the UNSIGNED deploy tx (SPEC §8.5, AGENT.md §5/§7).
//
// Auth + CSRF re-checked here. zod-validates the launchpad request, encodes the
// constructor args against the COMMITTED template bytecode (#11) via viem (Solidity
// is NEVER compiled at request time), estimates gas + reads congestion, and returns
// the unsigned contract-creation tx for the CLIENT to sign. The private key never
// comes near the server. A signed, opaque draft token pins every security-relevant
// value (network/chainId/data/ceilings/owner) so /broadcast can validate the signed
// tx against exactly what we authorized.
import type { NextRequest } from 'next/server';
import { jsonOk, toErrorResponse, getClientIp } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { requireCsrfUnlessApiKey } from '@/lib/auth/mutation-guard';
import { ValidationError, RateLimitError } from '@/lib/errors';
import { RATE_LIMITS, consumeRateLimit, rateLimitKey } from '@/lib/rate-limit';
import { getPublicClient } from '@/lib/chain/resolver';
import { deployEstimateSchema } from '@/lib/deployments/schema';
import { buildDeployData } from '@/lib/deployments/artifacts';
import { resolveActiveDeployNetwork } from '@/lib/deployments/context';
import { loadDeployCeilings } from '@/lib/deployments/ceilings';
import { encodeDraft, DRAFT_TTL_MS, type DeployDraft } from '@/lib/deployments/draft';

export const dynamic = 'force-dynamic';

/** Coarse congestion label from a block's gas utilization. */
function congestionLabel(gasUsed: bigint, gasLimit: bigint): 'low' | 'medium' | 'high' {
  if (gasLimit === 0n) return 'low';
  const pct = (gasUsed * 100n) / gasLimit;
  if (pct >= 80n) return 'high';
  if (pct >= 40n) return 'medium';
  return 'low';
}

export async function POST(req: NextRequest) {
  try {
    const principal = await requireAuth(req);
    requireCsrfUnlessApiKey(req);

    const results = await Promise.all([
      consumeRateLimit(rateLimitKey('deploy', 'user', principal.user.id), RATE_LIMITS.deploy),
      consumeRateLimit(rateLimitKey('deploy', 'ip', getClientIp(req)), RATE_LIMITS.deploy),
    ]);
    const blocked = results.find((r) => !r.allowed);
    if (blocked) throw new RateLimitError(blocked.retryAfterSec, 'Too many deploy requests.');

    const body: unknown = await req.json().catch(() => null);
    const parsed = deployEstimateSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
    }
    const request = parsed.data;

    const network = await resolveActiveDeployNetwork(request.networkId);
    const ceilings = await loadDeployCeilings();
    if (!ceilings.enabled) throw new ValidationError('Deployments are currently disabled.');

    const { contractName, data } = buildDeployData(request, request.ownerAddress);

    const publicClient = await getPublicClient();
    const liveChainId = await publicClient.getChainId();
    if (liveChainId !== network.chainId) {
      throw new ValidationError(
        `Active network chainId ${network.chainId} does not match the live RPC (${liveChainId}).`,
      );
    }

    // Gas + fee estimation. A 20% buffer absorbs constructor variance so the
    // client's signed gasLimit won't out-of-gas; the ceiling still bounds it.
    const rawGas = await publicClient.estimateGas({
      account: request.ownerAddress,
      data,
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
      address: request.ownerAddress as `0x${string}`,
    });

    const draft: DeployDraft = {
      v: 1,
      userId: principal.user.id,
      networkId: network.id,
      chainId: network.chainId,
      standard: request.standard,
      contractName,
      ownerAddress: request.ownerAddress,
      name: request.standard === 'ERC1155' ? '' : request.name,
      symbol: request.standard === 'ERC1155' ? null : request.symbol,
      initialSupply: request.standard === 'ERC20' ? request.initialSupply : null,
      baseUri: request.standard === 'ERC20' ? null : (request.baseUri ?? null),
      features: request.features,
      data,
      maxGas: ceilings.maxGas.toString(),
      maxValueWei: ceilings.maxValueWei.toString(),
      maxFeePerGasWei: ceilings.maxFeePerGasWei.toString(),
      exp: Date.now() + DRAFT_TTL_MS,
    };
    const deploymentDraftId = encodeDraft(draft);

    return jsonOk({
      estimatedGas: estimatedGas.toString(),
      baseFee: baseFee.toString(),
      congestion: congestionLabel(block.gasUsed, block.gasLimit),
      deploymentDraftId,
      unsignedTx: {
        type: 'eip1559',
        chainId: network.chainId,
        nonce,
        to: null,
        value: '0x0',
        data,
        gas: estimatedGas.toString(),
        maxFeePerGas: maxFeePerGas.toString(),
        maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

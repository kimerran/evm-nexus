// POST /api/smart-accounts/deploy — build the UNSIGNED factory-create tx (SPEC §8.9).
//
// Auth + CSRF re-checked here. The CLIENT-SIGNED deploy path: the owner EOA signs
// a normal tx that calls `SimpleAccountFactory.createAccount(owner, salt)`; the
// server never sees the key. We predict the account address, build the calldata
// against the COMMITTED factory ABI, estimate gas + fees, and return an unsigned
// tx plus an HMAC-signed draft pinning to/data/chainId/ceilings so /deploy/broadcast
// can validate the signed tx against exactly what we authorized. (A sponsored
// deploy instead flows through /api/userops/* via the account's initCode.)
import type { NextRequest } from 'next/server';
import { getContract, getAddress } from 'viem';
import type { Address } from 'viem';
import { prisma } from '@/lib/db';
import { jsonOk, toErrorResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { requireCsrfUnlessApiKey } from '@/lib/auth/mutation-guard';
import { ValidationError, RateLimitError } from '@/lib/errors';
import { RATE_LIMITS, consumeRateLimit, rateLimitKey } from '@/lib/rate-limit';
import { SimpleAccountFactoryAbi } from '@nexus/types';
import { getPublicClient } from '@/lib/chain/resolver';
import { deployPrepareSchema } from '@/lib/smart-wallets/schema';
import { resolveActiveSmartWalletNetwork } from '@/lib/smart-wallets/context';
import { requireStack } from '@/lib/smart-wallets/stack';
import { DEFAULT_SALT } from '@/lib/smart-wallets/constants';
import { buildCreateAccountData } from '@/lib/smart-wallets/userop';
import { encodeDeployDraft, DEPLOY_DRAFT_TTL_MS, type DeployDraft } from '@/lib/smart-wallets/draft';

export const dynamic = 'force-dynamic';

/** Ceilings for a factory-create tx (a create-account is cheap + non-payable). */
const MAX_DEPLOY_GAS = 1_500_000n;
const MAX_FEE_PER_GAS_WEI = 1_000_000_000_000n; // 1000 gwei

export async function POST(req: NextRequest) {
  try {
    const principal = await requireAuth(req);
    requireCsrfUnlessApiKey(req);

    const rl = await consumeRateLimit(
      rateLimitKey('userops', 'user', principal.user.id),
      RATE_LIMITS.userops,
    );
    if (!rl.allowed) throw new RateLimitError(rl.retryAfterSec, 'Too many requests.');

    const body: unknown = await req.json().catch(() => null);
    const parsed = deployPrepareSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
    }
    const { ownerAddress } = parsed.data;
    const saltBig = parsed.data.salt ? BigInt(parsed.data.salt) : DEFAULT_SALT;

    const network = await resolveActiveSmartWalletNetwork(parsed.data.networkId);
    const stack = await requireStack(network.id);

    const publicClient = await getPublicClient();
    const liveChainId = await publicClient.getChainId();
    if (liveChainId !== network.chainId) {
      throw new ValidationError(
        `Active network chainId ${network.chainId} does not match the live RPC (${liveChainId}).`,
      );
    }

    const factory = getContract({
      address: stack.factory,
      abi: SimpleAccountFactoryAbi,
      client: publicClient,
    });
    const predicted = getAddress(
      (await factory.read.getAddress([ownerAddress, saltBig])) as Address,
    );
    const existing = await publicClient.getCode({ address: predicted }).catch(() => undefined);
    if (existing && existing !== '0x') {
      throw new ValidationError('This smart account is already deployed.');
    }

    const data = buildCreateAccountData(ownerAddress, saltBig);

    const rawGas = await publicClient.estimateGas({
      account: ownerAddress,
      to: stack.factory,
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
    const nonce = await publicClient.getTransactionCount({ address: ownerAddress });

    const draft: DeployDraft = {
      v: 1,
      userId: principal.user.id,
      networkId: network.id,
      chainId: network.chainId,
      ownerAddress,
      accountAddress: predicted,
      factory: stack.factory,
      salt: saltBig.toString(),
      txTo: stack.factory,
      data,
      maxGas: MAX_DEPLOY_GAS.toString(),
      maxFeePerGasWei: MAX_FEE_PER_GAS_WEI.toString(),
      exp: Date.now() + DEPLOY_DRAFT_TTL_MS,
    };

    // Record the counterfactual account now (isDeployed flips on broadcast/sync).
    await prisma.smartAccount.upsert({
      where: { networkId_accountAddress: { networkId: network.id, accountAddress: predicted } },
      create: {
        userId: principal.user.id,
        ownerAddress,
        accountAddress: predicted,
        networkId: network.id,
        factory: stack.factory,
        isDeployed: false,
      },
      update: {},
    });

    return jsonOk({
      mode: 'client-signed' as const,
      accountAddress: predicted,
      deployDraftId: encodeDeployDraft(draft),
      estimatedGas: estimatedGas.toString(),
      unsignedTx: {
        type: 'eip1559',
        chainId: network.chainId,
        nonce,
        to: stack.factory,
        value: '0',
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

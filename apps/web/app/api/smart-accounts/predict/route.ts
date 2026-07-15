// POST /api/smart-accounts/predict — counterfactual address (SPEC §8.9).
//
// Auth + CSRF re-checked here. Computes the SimpleAccountFactory CREATE2 address
// for (owner, salt) via the factory's `getAddress` view on the ACTIVE network,
// upserts a SmartAccount record (isDeployed reconciled against on-chain code), and
// returns the predicted address. No key material is involved — this is a read plus
// a bookkeeping upsert.
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
import { predictSchema } from '@/lib/smart-wallets/schema';
import { resolveActiveSmartWalletNetwork } from '@/lib/smart-wallets/context';
import { requireStack } from '@/lib/smart-wallets/stack';
import { DEFAULT_SALT } from '@/lib/smart-wallets/constants';

export const dynamic = 'force-dynamic';

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
    const parsed = predictSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
    }
    const { ownerAddress, salt } = parsed.data;
    const saltBig = salt ? BigInt(salt) : DEFAULT_SALT;

    const network = await resolveActiveSmartWalletNetwork(parsed.data.networkId);
    const stack = await requireStack(network.id);

    const publicClient = await getPublicClient();
    const factory = getContract({
      address: stack.factory,
      abi: SimpleAccountFactoryAbi,
      client: publicClient,
    });
    const predicted = getAddress(
      (await factory.read.getAddress([ownerAddress, saltBig])) as Address,
    );
    const code = await publicClient.getCode({ address: predicted }).catch(() => undefined);
    const isDeployed = Boolean(code && code !== '0x');

    await prisma.smartAccount.upsert({
      where: { networkId_accountAddress: { networkId: network.id, accountAddress: predicted } },
      create: {
        userId: principal.user.id,
        ownerAddress,
        accountAddress: predicted,
        networkId: network.id,
        factory: stack.factory,
        isDeployed,
      },
      update: { isDeployed },
    });

    return jsonOk({
      ownerAddress,
      salt: saltBig.toString(),
      accountAddress: predicted,
      factory: stack.factory,
      entryPoint: stack.entryPoint,
      isDeployed,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

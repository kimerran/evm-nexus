// POST /api/userops/sponsor — scaffold + paymaster-sponsor a UserOp (SPEC §8.9).
//
// Auth + CSRF re-checked here; rate-limited AND budget-capped. From a high-level
// intent (owner + salt + one inner call) the server scaffolds the full v0.7
// UserOp — sender (counterfactual), initCode (only if the account isn't deployed),
// `execute` calldata, nonce, fees, and generous fixed gas limits. It enforces the
// paymaster budget cap (per-op + rolling daily, reserved in Redis) and then
// round-trips through the `userop-sponsor` WORKER to sign `paymasterAndData` — the
// PAYMASTER_SIGNER key never enters this process (prime directive, AGENT.md §5).
// Returns the fully-sponsored (unsigned) UserOp + the userOpHash for the client to
// sign in-browser with the owner key.
import type { NextRequest } from 'next/server';
import { getContract, getAddress } from 'viem';
import type { Address, Hex } from 'viem';
import { prisma } from '@/lib/db';
import { jsonOk, toErrorResponse } from '@/lib/http';
import { requireAuth } from '@/lib/auth/require-role';
import { requireCsrfUnlessApiKey } from '@/lib/auth/mutation-guard';
import { ValidationError, RateLimitError, AppError } from '@/lib/errors';
import { RATE_LIMITS, consumeRateLimit, rateLimitKey } from '@/lib/rate-limit';
import { EntryPointAbi, SimpleAccountFactoryAbi } from '@nexus/types';
import { getPublicClient } from '@/lib/chain/resolver';
import { sponsorSchema } from '@/lib/smart-wallets/schema';
import { resolveActiveSmartWalletNetwork } from '@/lib/smart-wallets/context';
import { requireStack } from '@/lib/smart-wallets/stack';
import { DEFAULT_SALT, DEFAULT_USEROP_GAS } from '@/lib/smart-wallets/constants';
import {
  buildExecuteCallData,
  buildCreateAccountData,
  computeUserOpHash,
  userOpMaxCostWei,
  type SerializedUserOperation,
} from '@/lib/smart-wallets/userop';
import { loadBudgetCaps, reservePaymasterBudget } from '@/lib/smart-wallets/budget';
import { requestSponsor } from '@/lib/queue/userop-queue';

export const dynamic = 'force-dynamic';

/** 503 — a worker-backed dependency (paymaster signer) is unavailable. */
class ServiceUnavailableError extends AppError {
  constructor(message = 'Sponsorship service is temporarily unavailable.') {
    super(503, 'SERVICE_UNAVAILABLE', message);
  }
}

export async function POST(req: NextRequest) {
  try {
    const principal = await requireAuth(req);
    requireCsrfUnlessApiKey(req);

    const rl = await consumeRateLimit(
      rateLimitKey('userops', 'user', principal.user.id),
      RATE_LIMITS.userops,
    );
    if (!rl.allowed) throw new RateLimitError(rl.retryAfterSec, 'Too many sponsor requests.');

    const body: unknown = await req.json().catch(() => null);
    const parsed = sponsorSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid request body.');
    }
    const { ownerAddress, call } = parsed.data;
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
    const sender = getAddress((await factory.read.getAddress([ownerAddress, saltBig])) as Address);

    const code = await publicClient.getCode({ address: sender }).catch(() => undefined);
    const isDeployed = Boolean(code && code !== '0x');

    // v0.7 nonce (key 0) from the EntryPoint.
    const entryPoint = getContract({
      address: stack.entryPoint,
      abi: EntryPointAbi,
      client: publicClient,
    });
    const nonce = (await entryPoint.read.getNonce([sender, 0n])) as bigint;

    const block = await publicClient.getBlock({ blockTag: 'latest' });
    const baseFee = block.baseFeePerGas ?? 0n;
    let maxPriorityFeePerGas: bigint;
    try {
      maxPriorityFeePerGas = await publicClient.estimateMaxPriorityFeePerGas();
    } catch {
      maxPriorityFeePerGas = 1_000_000_000n;
    }
    const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;

    const callData = buildExecuteCallData({ to: call.to, value: BigInt(call.value), data: call.data as Hex });

    // Scaffold the UserOp. Paymaster address + its two gas limits are set now (the
    // paymaster's getHash reads them); paymasterData is filled by the worker.
    const userOp: SerializedUserOperation = {
      sender,
      nonce: nonce.toString(),
      callData,
      callGasLimit: DEFAULT_USEROP_GAS.callGasLimit.toString(),
      verificationGasLimit: DEFAULT_USEROP_GAS.verificationGasLimit.toString(),
      preVerificationGas: DEFAULT_USEROP_GAS.preVerificationGas.toString(),
      maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
      paymaster: stack.paymaster,
      paymasterVerificationGasLimit: DEFAULT_USEROP_GAS.paymasterVerificationGasLimit.toString(),
      paymasterPostOpGasLimit: DEFAULT_USEROP_GAS.paymasterPostOpGasLimit.toString(),
      signature: '0x',
      ...(isDeployed
        ? {}
        : { factory: stack.factory, factoryData: buildCreateAccountData(ownerAddress, saltBig) }),
    };

    // Budget cap: reserve the worst-case cost BEFORE the paymaster signs.
    const caps = await loadBudgetCaps();
    const opCost = userOpMaxCostWei(userOp);
    const decision = await reservePaymasterBudget({ networkId: network.id, caps, opCostWei: opCost });
    if (!decision.allowed) {
      throw new ValidationError(decision.message);
    }

    // Round-trip to the worker to sign paymasterAndData (worker-only key).
    let sponsored;
    try {
      sponsored = await requestSponsor({ networkId: network.id, userOp });
    } catch {
      throw new ServiceUnavailableError(
        'Could not obtain a paymaster signature — is the worker running?',
      );
    }

    const sponsoredUserOp: SerializedUserOperation = {
      ...userOp,
      paymaster: getAddress(sponsored.paymaster),
      paymasterVerificationGasLimit: sponsored.paymasterVerificationGasLimit,
      paymasterPostOpGasLimit: sponsored.paymasterPostOpGasLimit,
      paymasterData: sponsored.paymasterData as Hex,
    };

    const userOpHash = computeUserOpHash(sponsoredUserOp, stack.entryPoint, network.chainId);

    await prisma.smartAccount.upsert({
      where: { networkId_accountAddress: { networkId: network.id, accountAddress: sender } },
      create: {
        userId: principal.user.id,
        ownerAddress,
        accountAddress: sender,
        networkId: network.id,
        factory: stack.factory,
        isDeployed,
      },
      update: { isDeployed },
    });

    return jsonOk({
      sender,
      entryPoint: stack.entryPoint,
      userOp: sponsoredUserOp,
      userOpHash,
      validUntil: sponsored.validUntil,
      maxCostWei: opCost.toString(),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

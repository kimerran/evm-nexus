// One-time ERC-4337 v0.7 stack deploy path (SPEC §6/§8.9, AGENT.md §7).
//
// Anvil has no canonical EntryPoint, so this operational script deploys the
// eth-infinitism reference stack (EntryPoint + SimpleAccountFactory +
// VerifyingPaymaster), funds the paymaster's EntryPoint deposit + stake, and
// records the (public) addresses in a single AppSetting row per network. Run by
// an operator after the network is seeded:
//
//   pnpm tsx apps/web/scripts/deploy-4337.ts
//
// Keys used here are TEST-CHAIN funded keys for this operational script only
// (never the web app): DEPLOYER_PRIVATE_KEY (or RELAYER_PRIVATE_KEY) pays for the
// deploys; PAYMASTER_SIGNER_PRIVATE_KEY provides only the paymaster's verifying
// SIGNER ADDRESS (the constructor arg). Neither key is ever logged. Solidity is
// never compiled here — only the precompiled ABI + bytecode are deployed.
import { config as loadEnv } from 'dotenv';
loadEnv();

import { createPublicClient, createWalletClient, defineChain, http, isHex, getAddress, parseEther } from 'viem';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PrismaPg } from '@prisma/adapter-pg';
import { getEnv } from '@nexus/config/env';
import {
  EntryPointAbi,
  EntryPointBytecode,
  SimpleAccountFactoryAbi,
  SimpleAccountFactoryBytecode,
  VerifyingPaymasterAbi,
  VerifyingPaymasterBytecode,
} from '@nexus/types';
import { PrismaClient } from '../lib/generated/prisma/client';
import { stackSettingKey } from '../lib/smart-wallets/keys';

/** EntryPoint deposit that prefunds sponsored UserOp gas. */
const PAYMASTER_DEPOSIT_ETH = '10';
/** Paymaster stake (satisfies EntryPoint reputation rules for a paymaster). */
const PAYMASTER_STAKE_ETH = '1';
const STAKE_UNSTAKE_DELAY_SEC = 86_400;

function requireKey(name: string, value: string | undefined): Hex {
  if (!value || !isHex(value) || value.length !== 66) {
    throw new Error(`${name} must be a 0x-prefixed 32-byte hex key.`);
  }
  return value;
}

async function main(): Promise<void> {
  const env = getEnv();
  const deployerKey = requireKey(
    'DEPLOYER_PRIVATE_KEY/RELAYER_PRIVATE_KEY',
    process.env.DEPLOYER_PRIVATE_KEY ?? env.RELAYER_PRIVATE_KEY,
  );
  const paymasterSignerKey = requireKey('PAYMASTER_SIGNER_PRIVATE_KEY', env.PAYMASTER_SIGNER_PRIVATE_KEY);
  const paymasterSigner = privateKeyToAccount(paymasterSignerKey).address;

  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const network = await prisma.network.findFirst({ where: { isDefault: true } });
    if (!network) throw new Error('No active (default) network configured. Seed first.');

    const chain = defineChain({
      id: network.chainId,
      name: network.name,
      nativeCurrency: { name: network.nativeSymbol, symbol: network.nativeSymbol, decimals: 18 },
      rpcUrls: { default: { http: [network.rpcUrl] } },
    });
    const account = privateKeyToAccount(deployerKey);
    const publicClient = createPublicClient({ chain, transport: http(network.rpcUrl) });
    const walletClient = createWalletClient({ account, chain, transport: http(network.rpcUrl) });

    const liveChainId = await publicClient.getChainId();
    if (liveChainId !== network.chainId) {
      throw new Error(`chainId mismatch: live ${liveChainId} != configured ${network.chainId}`);
    }

    async function confirmDeploy(name: string, hash: Hex): Promise<Hex> {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success' || !receipt.contractAddress) {
        throw new Error(`${name} deploy failed (status=${receipt.status}).`);
      }
      const address = getAddress(receipt.contractAddress);
      console.log(`+ ${name} deployed at ${address}`);
      return address;
    }

    console.log(`Deploying ERC-4337 v0.7 stack to ${network.name} (chainId ${network.chainId})…`);
    const entryPoint = await confirmDeploy(
      'EntryPoint',
      await walletClient.deployContract({ abi: EntryPointAbi, bytecode: EntryPointBytecode as Hex, account }),
    );
    const factory = await confirmDeploy(
      'SimpleAccountFactory',
      await walletClient.deployContract({
        abi: SimpleAccountFactoryAbi,
        bytecode: SimpleAccountFactoryBytecode as Hex,
        account,
        args: [entryPoint],
      }),
    );
    const paymaster = await confirmDeploy(
      'VerifyingPaymaster',
      await walletClient.deployContract({
        abi: VerifyingPaymasterAbi,
        bytecode: VerifyingPaymasterBytecode as Hex,
        account,
        args: [entryPoint, paymasterSigner],
      }),
    );

    // Fund the paymaster's EntryPoint deposit (prefunds sponsored gas) + stake it.
    const depositHash = await walletClient.writeContract({
      address: entryPoint,
      abi: EntryPointAbi,
      functionName: 'depositTo',
      args: [paymaster],
      value: parseEther(PAYMASTER_DEPOSIT_ETH),
      account,
      chain,
    });
    await publicClient.waitForTransactionReceipt({ hash: depositHash });
    console.log(`+ paymaster EntryPoint deposit funded: ${PAYMASTER_DEPOSIT_ETH} ETH`);

    const stakeHash = await walletClient.writeContract({
      address: paymaster,
      abi: VerifyingPaymasterAbi,
      functionName: 'addStake',
      args: [STAKE_UNSTAKE_DELAY_SEC],
      value: parseEther(PAYMASTER_STAKE_ETH),
      account,
      chain,
    });
    await publicClient.waitForTransactionReceipt({ hash: stakeHash });
    console.log(`+ paymaster staked: ${PAYMASTER_STAKE_ETH} ETH`);

    const value = {
      entryPoint,
      factory,
      paymaster,
      paymasterSigner: getAddress(paymasterSigner),
    };
    const key = stackSettingKey(network.id);
    await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    // Also mirror onto the Network row's public address columns for convenience.
    await prisma.network.update({
      where: { id: network.id },
      data: { entryPointAddress: entryPoint, paymasterAddress: paymaster },
    });

    console.log(`+ stored AppSetting "${key}"`);
    console.log(JSON.stringify(value, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

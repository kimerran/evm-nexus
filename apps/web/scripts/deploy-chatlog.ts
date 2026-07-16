// One-time ChatLog deploy path (SPEC §6/§8.8, AGENT.md §7).
//
// Deploys the committed ChatLog artifact once per network and stores its address
// in the existing `AppSetting` key-value model (no schema change). Run by an admin
// after the network is seeded:
//
//   DEPLOYER_PRIVATE_KEY=0x… pnpm tsx apps/web/scripts/deploy-chatlog.ts
//
// The deployer key is a TEST-CHAIN funded key used ONLY by this operational
// script (never the web app). If unset, RELAYER_PRIVATE_KEY is used. Solidity is
// never compiled here — only the precompiled ABI + bytecode are deployed.
import { config as loadEnv } from 'dotenv';
loadEnv();

import { createPublicClient, createWalletClient, defineChain, http, isHex, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PrismaPg } from '@prisma/adapter-pg';
import { getEnv } from '@nexus/config/env';
import { ChatLogAbi, ChatLogBytecode } from '@nexus/types';
import { PrismaClient } from '../lib/generated/prisma/client';

async function main(): Promise<void> {
  const env = getEnv();
  const rawKey = process.env.DEPLOYER_PRIVATE_KEY ?? env.RELAYER_PRIVATE_KEY;
  if (!rawKey || !isHex(rawKey) || rawKey.length !== 66) {
    throw new Error('DEPLOYER_PRIVATE_KEY (or RELAYER_PRIVATE_KEY) must be a 0x 32-byte hex key.');
  }

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
    const account = privateKeyToAccount(rawKey);
    const publicClient = createPublicClient({ chain, transport: http(network.rpcUrl) });
    const walletClient = createWalletClient({ account, chain, transport: http(network.rpcUrl) });

    const liveChainId = await publicClient.getChainId();
    if (liveChainId !== network.chainId) {
      throw new Error(`chainId mismatch: live ${liveChainId} != configured ${network.chainId}`);
    }

    console.log(`Deploying ChatLog to ${network.name} (chainId ${network.chainId})…`);
    const txHash = await walletClient.deployContract({
      abi: ChatLogAbi,
      bytecode: ChatLogBytecode,
      account,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success' || !receipt.contractAddress) {
      throw new Error(`ChatLog deploy failed (status=${receipt.status}).`);
    }
    const address = getAddress(receipt.contractAddress);

    const key = `chat.chatLogAddress:${network.id}`;
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: { address } },
      update: { value: { address } },
    });

    console.log(`+ ChatLog deployed at ${address}`);
    console.log(`+ tx ${txHash}`);
    console.log(`+ stored AppSetting "${key}"`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

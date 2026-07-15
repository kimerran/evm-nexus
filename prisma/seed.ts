// Idempotent database seed (SPEC §16).
//
// Creates the admin user, the default Network, and baseline AppSetting ceilings.
// Every step is create-if-absent, so re-running is a strict no-op (no writes, no
// error) — which the auto-dev gate proves by running it twice. The admin
// password is NEVER hardcoded: it comes from ADMIN_PASSWORD and is stored only
// as an argon2id hash.
//
// Prisma 7 does not auto-load .env, so we load it before touching env/config.
import { config as loadEnv } from 'dotenv';
loadEnv();

import { Algorithm, hash } from '@node-rs/argon2';
import { getEnv } from '@nexus/config/env';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/web/lib/generated/prisma/client';

// Argon2id parameters (OWASP-aligned baseline; AGENT.md §5).
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

async function seedAdmin(prisma: PrismaClient): Promise<void> {
  const env = getEnv();
  if (!env.ADMIN_PASSWORD) {
    throw new Error('ADMIN_PASSWORD is required to seed the admin user (never hardcode it).');
  }

  const existing = await prisma.user.findUnique({ where: { username: env.ADMIN_USERNAME } });
  if (existing) {
    console.log(`✓ admin user "${env.ADMIN_USERNAME}" already exists — skipping`);
    return;
  }

  const passwordHash = await hash(env.ADMIN_PASSWORD, ARGON2_OPTIONS);
  await prisma.user.create({
    data: {
      username: env.ADMIN_USERNAME,
      passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
  });
  console.log(`+ created admin user "${env.ADMIN_USERNAME}" (role=ADMIN)`);
}

async function seedDefaultNetwork(prisma: PrismaClient): Promise<void> {
  const env = getEnv();

  const existing = await prisma.network.findUnique({
    where: { chainId_name: { chainId: env.DEFAULT_CHAIN_ID, name: env.DEFAULT_NETWORK_NAME } },
  });
  if (existing) {
    console.log(`✓ default network "${env.DEFAULT_NETWORK_NAME}" already exists — skipping`);
    return;
  }

  // The default RPC URL is a credential-free localhost endpoint, so it is stored
  // as plaintext. Any RPC URL that embeds an API key/credential must be wrapped
  // with `encryptAtRest()` (apps/web/lib/crypto/at-rest) before persisting.
  await prisma.network.create({
    data: {
      name: env.DEFAULT_NETWORK_NAME,
      chainId: env.DEFAULT_CHAIN_ID,
      rpcUrl: env.DEFAULT_RPC_URL,
      explorerBaseUrl: env.DEFAULT_EXPLORER_URL ?? null,
      nativeSymbol: env.DEFAULT_NATIVE_SYMBOL,
      isDefault: true,
      faucetEnabled: true,
      faucetDripAmount: env.FAUCET_DRIP_WEI,
      faucetDailyCap: env.FAUCET_DAILY_CAP_WEI,
    },
  });
  console.log(
    `+ created default network "${env.DEFAULT_NETWORK_NAME}" (chainId=${env.DEFAULT_CHAIN_ID}, isDefault=true)`,
  );
}

async function seedAppSettings(prisma: PrismaClient): Promise<void> {
  const env = getEnv();

  // Baseline global ceilings & kill-switches (SPEC §11.1 / §16.3). Values are
  // JSON; wei amounts stay strings to avoid precision loss (AGENT.md §4).
  const baseline: Record<string, unknown> = {
    'bombard.maxTps': env.BOMBARD_MAX_TPS,
    'bombard.maxTotal': env.BOMBARD_MAX_TOTAL,
    'bombard.enabled': true,
    // Per-tx chain-safety ceilings + the RELAYER-mode target allow-list (SPEC
    // §4.3/§8.7). Gas/wei stay strings; the allow-list is empty by default so
    // relayer mode is disabled until an admin adds approved targets.
    'bombard.maxGasPerTx': '100000',
    'bombard.maxValuePerTxWei': '1000000000000000000',
    'bombard.maxFeePerGasWei': '1000000000000',
    'bombard.allowlist': [],
    'faucet.dripWei': env.FAUCET_DRIP_WEI,
    'faucet.dailyCapWei': env.FAUCET_DAILY_CAP_WEI,
    'faucet.enabled': true,
    'paymaster.enabled': true,
    // Deploy chain-safety ceilings + kill-switch (SPEC §8.5, AGENT.md §5). Gas
    // units + wei stay strings to avoid precision loss.
    'deploy.enabled': true,
    'deploy.maxGas': '15000000',
    'deploy.maxValueWei': '0',
    'deploy.maxFeePerGasWei': '1000000000000',
    // Transfer chain-safety ceilings + kill-switch (SPEC §8.6, AGENT.md §5). A
    // native transfer moves value, so maxValueWei is non-zero (unlike deploys).
    'transfer.enabled': true,
    'transfer.maxGas': '500000',
    'transfer.maxValueWei': '1000000000000000000000',
    'transfer.maxFeePerGasWei': '1000000000000',
    // On-chain chat commit ceilings + kill-switch (SPEC §8.8, AGENT.md §5). A
    // ChatLog.commit is a non-payable event log, so maxValueWei is enforced as 0
    // in code; gas is bounded tightly. `chat.relayerDailyCap` caps the operator-
    // relayed (budget-capped) alternative to a client-signed commit.
    'chat.enabled': true,
    'chat.maxGas': '200000',
    'chat.maxFeePerGasWei': '1000000000000',
    'chat.relayerDailyCap': 200,
    // Smart-wallet (ERC-4337) sponsorship budget caps + kill-switch (SPEC §8.9,
    // AGENT.md §5). `maxOpCostWei` bounds a single sponsored UserOp's max gas
    // cost; `dailyCapWei` is the rolling per-day paymaster spend ceiling. Wei
    // stay strings to avoid precision loss.
    'userop.sponsorEnabled': true,
    'userop.maxOpCostWei': '100000000000000000', // 0.1 ETH per op
    'userop.dailyCapWei': '5000000000000000000', // 5 ETH/day paymaster budget
  };

  for (const [key, value] of Object.entries(baseline)) {
    const existing = await prisma.appSetting.findUnique({ where: { key } });
    if (existing) {
      console.log(`✓ app setting "${key}" already exists — skipping`);
      continue;
    }
    await prisma.appSetting.create({ data: { key, value: value as never } });
    console.log(`+ created app setting "${key}"`);
  }
}

async function main(): Promise<void> {
  const env = getEnv();
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    console.log('Seeding EVM Nexus database (idempotent)…');
    await seedAdmin(prisma);
    await seedDefaultNetwork(prisma);
    await seedAppSettings(prisma);
    console.log('Seed complete.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});

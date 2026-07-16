// Shared helpers for the `*.integration.test.ts` suite (AGENT.md §8).
//
// Integration tests run against the REAL test Postgres + Redis + anvil and assert
// BOTH DB state and on-chain effects. These helpers keep each spec focused on the
// behaviour under test: minting an API key (Bearer auth bypasses CSRF exactly the
// way a scripting client does — we never weaken a guard to make a test pass),
// building a `NextRequest` for a route handler, an anvil viem client, and a clean
// teardown so open ioredis/Prisma handles don't wedge the runner.
import { NextRequest } from 'next/server';
import { createPublicClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { getEnv } from '@nexus/config/env';
import { prisma } from '@/lib/db';
import { generateApiKey } from '@/lib/auth/api-key';
import { getRedis } from '@/lib/redis';
import { getQueueConnection } from '@/lib/queue/connection';

/** The seeded admin user (present after `prisma db seed`). */
export async function getAdminUserId(): Promise<string> {
  const username = getEnv().ADMIN_USERNAME;
  const user = await prisma.user.findFirst({ where: { username } });
  if (!user) throw new Error(`seed admin "${username}" not found — run \`pnpm prisma db seed\``);
  return user.id;
}

/** Mint a live API key for a user and return the raw Bearer token. */
export async function mintApiKey(userId: string): Promise<string> {
  const { token, keyHash, prefix } = generateApiKey();
  await prisma.apiKey.create({
    data: { userId, name: `integration-${Date.now()}`, keyHash, prefix },
  });
  return token;
}

/** Build a `NextRequest` for a route handler, authenticated by API key (no CSRF). */
export function apiRequest(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (opts.token) headers.set('authorization', `Bearer ${opts.token}`);
  headers.set('x-forwarded-for', '10.0.0.1');
  return new NextRequest(`http://localhost:3000${path}`, {
    method: opts.method ?? 'POST',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

/** The default (active) network row. */
export async function getDefaultNetwork() {
  const network = await prisma.network.findFirst({ where: { isDefault: true } });
  if (!network) throw new Error('no default network — run the seed');
  return network;
}

/** A read-only viem client bound to the live anvil chain. */
export async function anvilPublicClient() {
  const network = await getDefaultNetwork();
  const chain = defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: { name: network.nativeSymbol, symbol: network.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: [network.rpcUrl] } },
  });
  return createPublicClient({ chain, transport: http(network.rpcUrl) });
}

/**
 * A funded anvil account NOT used as an operator key — a stand-in for a user's
 * in-browser vault key where an integration test needs a server-side signer.
 * anvil account #6 (0x976E…0aa9); funded with 10_000 ETH at genesis.
 */
export const TEST_SIGNER_KEY: Hex =
  '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e';
export const testSigner = privateKeyToAccount(TEST_SIGNER_KEY);

/** anvil account #7 (0x14dC…a4Dc) — a second funded signer for chat/transfer specs. */
export const TEST_SIGNER_KEY_2: Hex =
  '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356';
export const testSigner2 = privateKeyToAccount(TEST_SIGNER_KEY_2);

/** Close pooled ioredis + Prisma handles so Vitest exits cleanly. */
export async function teardownConnections(): Promise<void> {
  try {
    getRedis().disconnect();
  } catch {
    /* ignore */
  }
  try {
    getQueueConnection().disconnect();
  } catch {
    /* ignore */
  }
  await prisma.$disconnect().catch(() => undefined);
}

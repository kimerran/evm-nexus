// Worker chain access — loads the active faucet network + builds viem clients
// bound to the OPERATOR signer (AGENT.md §0/§5, SPEC §9).
//
// This is the only place the faucet key is turned into a signer. Clients target
// exactly the network's RPC; the processor verifies the live chainId equals the
// configured one BEFORE any broadcast. Amounts are bigint/wei.
import { createPublicClient, createWalletClient, defineChain, http, getAddress, isAddress } from 'viem';
import type { Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { prisma } from './prisma';
import { getFaucetPrivateKey, getRelayerPrivateKey, getPaymasterSignerPrivateKey } from './config';
import { stackSettingKey } from '../../apps/web/lib/smart-wallets/keys';

/** Decoded faucet network config for the worker (wei as bigint). */
export interface WorkerFaucetNetwork {
  id: string;
  chainId: number;
  name: string;
  rpcUrl: string;
  nativeSymbol: string;
  nativeDecimals: number;
  faucetEnabled: boolean;
  dripWei: bigint;
  dailyCapWei: bigint;
  cooldownSec: number;
}

/** Load a network's faucet config by id. Returns `null` when it does not exist. */
export async function loadFaucetNetwork(networkId: string): Promise<WorkerFaucetNetwork | null> {
  const network = await prisma.network.findUnique({ where: { id: networkId } });
  if (!network) return null;
  if (network.rpcUrl.startsWith('enc:')) {
    // Credentialed RPC URLs are encrypted at rest by the web app; the worker in
    // this scope targets a plaintext localhost RPC and does not decrypt.
    throw new Error('Encrypted RPC URLs are not supported by the faucet worker.');
  }
  return {
    id: network.id,
    chainId: network.chainId,
    name: network.name,
    rpcUrl: network.rpcUrl,
    nativeSymbol: network.nativeSymbol,
    nativeDecimals: network.nativeDecimals,
    faucetEnabled: network.faucetEnabled,
    dripWei: BigInt(network.faucetDripAmount),
    dailyCapWei: BigInt(network.faucetDailyCap),
    cooldownSec: network.faucetCooldownSec,
  };
}

function toChain(network: WorkerFaucetNetwork) {
  return defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: {
      name: network.nativeSymbol,
      symbol: network.nativeSymbol,
      decimals: network.nativeDecimals,
    },
    rpcUrls: { default: { http: [network.rpcUrl] } },
  });
}

/** Build the public + operator-signed wallet clients for a network. */
export function buildFaucetClients(network: WorkerFaucetNetwork) {
  const chain = toChain(network);
  const account = privateKeyToAccount(getFaucetPrivateKey());
  const publicClient = createPublicClient({ chain, transport: http(network.rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(network.rpcUrl) });
  return { account, publicClient, walletClient };
}

/** Minimal network identity for a read-only watcher (no operator key needed). */
export interface WorkerNetwork {
  id: string;
  chainId: number;
  name: string;
  rpcUrl: string;
  nativeSymbol: string;
  nativeDecimals: number;
}

/**
 * Load a network's basic identity by id (for read-only watchers like
 * deploy-watch, which never sign). Returns `null` when it does not exist.
 */
export async function loadNetworkBasic(networkId: string): Promise<WorkerNetwork | null> {
  const network = await prisma.network.findUnique({ where: { id: networkId } });
  if (!network) return null;
  if (network.rpcUrl.startsWith('enc:')) {
    // Credentialed RPC URLs are encrypted at rest by the web app; the worker in
    // this scope targets a plaintext localhost RPC and does not decrypt.
    throw new Error('Encrypted RPC URLs are not supported by the worker.');
  }
  return {
    id: network.id,
    chainId: network.chainId,
    name: network.name,
    rpcUrl: network.rpcUrl,
    nativeSymbol: network.nativeSymbol,
    nativeDecimals: network.nativeDecimals,
  };
}

function toBasicChain(network: WorkerNetwork) {
  return defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: {
      name: network.nativeSymbol,
      symbol: network.nativeSymbol,
      decimals: network.nativeDecimals,
    },
    rpcUrls: { default: { http: [network.rpcUrl] } },
  });
}

/** Build a read-only public client for a network (no signer). */
export function buildPublicClientForNetwork(network: WorkerNetwork) {
  return createPublicClient({ chain: toBasicChain(network), transport: http(network.rpcUrl) });
}

/** The deployed ERC-4337 stack addresses for a network (all public). */
export interface WorkerStack {
  entryPoint: Address;
  factory: Address;
  paymaster: Address;
  paymasterSigner: Address;
}

/**
 * Load the ERC-4337 stack addresses for a network from AppSetting (written by
 * scripts/deploy-4337.ts). Returns `null` when the stack has not been deployed.
 * These are PUBLIC addresses — never keys.
 */
export async function loadStack(networkId: string): Promise<WorkerStack | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: stackSettingKey(networkId) } });
  if (!row || typeof row.value !== 'object' || row.value === null) return null;
  const v = row.value as Record<string, unknown>;
  const fields = [v.entryPoint, v.factory, v.paymaster, v.paymasterSigner];
  if (!fields.every((f) => typeof f === 'string' && isAddress(f))) return null;
  return {
    entryPoint: getAddress(v.entryPoint as string),
    factory: getAddress(v.factory as string),
    paymaster: getAddress(v.paymaster as string),
    paymasterSigner: getAddress(v.paymasterSigner as string),
  };
}

/**
 * The paymaster verifying-signer account (worker-only key). Used ONLY by the
 * `userop-sponsor` processor to sign `paymasterAndData`. Loaded here and never in
 * the web app (prime directive, AGENT.md §5).
 */
export function buildPaymasterSignerAccount() {
  return privateKeyToAccount(getPaymasterSignerPrivateKey());
}

/**
 * Build the public + RELAYER-signed wallet clients for a network. Used ONLY by
 * the bombard-runner in RELAYER mode — the operator key is loaded here and never
 * in the web app (prime directive). Client-signed runs use only the public client.
 */
export function buildRelayerClients(network: WorkerNetwork) {
  const chain = toBasicChain(network);
  const account = privateKeyToAccount(getRelayerPrivateKey());
  const publicClient = createPublicClient({ chain, transport: http(network.rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(network.rpcUrl) });
  return { account, publicClient, walletClient };
}

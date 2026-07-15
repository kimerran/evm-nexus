// Worker chain access — loads the active faucet network + builds viem clients
// bound to the OPERATOR signer (AGENT.md §0/§5, SPEC §9).
//
// This is the only place the faucet key is turned into a signer. Clients target
// exactly the network's RPC; the processor verifies the live chainId equals the
// configured one BEFORE any broadcast. Amounts are bigint/wei.
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { prisma } from './prisma';
import { getFaucetPrivateKey } from './config';

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

/** Build a read-only public client for a network (no signer). */
export function buildPublicClientForNetwork(network: WorkerNetwork) {
  const chain = defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: {
      name: network.nativeSymbol,
      symbol: network.nativeSymbol,
      decimals: network.nativeDecimals,
    },
    rpcUrls: { default: { http: [network.rpcUrl] } },
  });
  return createPublicClient({ chain, transport: http(network.rpcUrl) });
}

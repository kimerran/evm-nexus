// Network resolver — the single path all on-chain reads/writes flow through
// (SPEC §5/§8.2, AGENT.md §5 chain-safety).
//
// SERVER-ONLY. Reads the ACTIVE network (the one `Network.isDefault = true`) and
// builds viem public + wallet clients from its config. Only admin-approved
// networks in the DB are ever used; arbitrary browser-supplied RPC URLs are
// never proxied. Amounts are handled as bigint/wei in memory; nothing here
// persists money (AGENT.md §4).
//
// The pure builders (`toViemChain`, `buildPublicClient`, `buildWalletClient`)
// take a plain config so they are unit-testable without a database, while
// `getActiveNetwork*` bind them to the live Prisma singleton.
import { createPublicClient, createWalletClient, defineChain, http, webSocket } from 'viem';
import type { Account, Chain } from 'viem';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { decodeRpcUrlFromStorage } from './rpc-url';

/**
 * Minimal, decoded network configuration needed to talk to a chain. `rpcUrl`
 * here is the USABLE (already-decrypted) endpoint — never a stored envelope.
 */
export interface NetworkClientConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  wsUrl?: string | null;
  nativeSymbol: string;
  nativeDecimals: number;
  explorerBaseUrl?: string | null;
}

/** Options controlling which transport a client uses. */
export interface ClientTransportOptions {
  /** Use the WebSocket transport when the network defines `wsUrl`. */
  preferWebSocket?: boolean;
}

/** Build a viem {@link Chain} descriptor from a network config. */
export function toViemChain(config: NetworkClientConfig): Chain {
  return defineChain({
    id: config.chainId,
    name: config.name,
    nativeCurrency: {
      name: config.nativeSymbol,
      symbol: config.nativeSymbol,
      decimals: config.nativeDecimals,
    },
    rpcUrls: {
      default: {
        http: [config.rpcUrl],
        ...(config.wsUrl ? { webSocket: [config.wsUrl] } : {}),
      },
    },
    ...(config.explorerBaseUrl
      ? {
          blockExplorers: {
            default: { name: `${config.name} Explorer`, url: config.explorerBaseUrl },
          },
        }
      : {}),
  });
}

function resolveTransport(config: NetworkClientConfig, options?: ClientTransportOptions) {
  if (options?.preferWebSocket && config.wsUrl) {
    return webSocket(config.wsUrl);
  }
  return http(config.rpcUrl);
}

/** Build a read-only viem public client for a network config. */
export function buildPublicClient(config: NetworkClientConfig, options?: ClientTransportOptions) {
  return createPublicClient({
    chain: toViemChain(config),
    transport: resolveTransport(config, options),
  });
}

/**
 * Build a viem wallet client for a network config. `account` is injected by the
 * caller (a server-custodied signer, wired in a later feature); omit it for an
 * unbound client used only to prepare/simulate transactions.
 */
export function buildWalletClient(
  config: NetworkClientConfig,
  account?: Account,
  options?: ClientTransportOptions,
) {
  return createWalletClient({
    chain: toViemChain(config),
    transport: resolveTransport(config, options),
    ...(account ? { account } : {}),
  });
}

/**
 * Load the ACTIVE network (`isDefault = true`) and return its decoded config.
 * Throws {@link NotFoundError} when no default network is configured.
 */
export async function getActiveNetworkConfig(): Promise<NetworkClientConfig> {
  const network = await prisma.network.findFirst({ where: { isDefault: true } });
  if (!network) {
    throw new NotFoundError('No active (default) network is configured.');
  }
  return {
    chainId: network.chainId,
    name: network.name,
    rpcUrl: decodeRpcUrlFromStorage(network.rpcUrl),
    wsUrl: network.wsUrl,
    nativeSymbol: network.nativeSymbol,
    nativeDecimals: network.nativeDecimals,
    explorerBaseUrl: network.explorerBaseUrl,
  };
}

/** Public client bound to the current active network. */
export async function getPublicClient(options?: ClientTransportOptions) {
  return buildPublicClient(await getActiveNetworkConfig(), options);
}

/** Wallet client bound to the current active network (optional signer). */
export async function getWalletClient(account?: Account, options?: ClientTransportOptions) {
  return buildWalletClient(await getActiveNetworkConfig(), account, options);
}

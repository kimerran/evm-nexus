// Network → client DTO (SPEC §8.2). RPC secrets are REDACTED here so they never
// leave the server. A stored rpcUrl/wsUrl is decoded server-side then reduced to
// its origin (`protocol//host`), dropping any userinfo/path/query credential.
import type { Network } from '@/lib/generated/prisma/client';
import { decodeRpcUrlFromStorage, isEncodedRpcUrl, redactRpcUrl } from './rpc-url';

/** Public, secret-free view of a Network returned to any authenticated caller. */
export interface NetworkDto {
  id: string;
  name: string;
  chainId: number;
  /** Redacted RPC origin only — never the credentialed URL. */
  rpcUrl: string | null;
  /** True when the stored RPC URL carries an encrypted credential. */
  rpcUrlHasSecret: boolean;
  wsUrl: string | null;
  explorerBaseUrl: string | null;
  nativeSymbol: string;
  nativeDecimals: number;
  isDefault: boolean;
  isArchival: boolean;
  faucetEnabled: boolean;
  faucetDripAmount: string;
  faucetDailyCap: string;
  faucetCooldownSec: number;
  paymasterAddress: string | null;
  entryPointAddress: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Redact a network row into its secret-free client DTO. */
export function toNetworkDto(network: Network): NetworkDto {
  const rpcPlain = decodeRpcUrlFromStorage(network.rpcUrl);
  return {
    id: network.id,
    name: network.name,
    chainId: network.chainId,
    rpcUrl: redactRpcUrl(rpcPlain),
    rpcUrlHasSecret: isEncodedRpcUrl(network.rpcUrl),
    wsUrl: network.wsUrl ? redactRpcUrl(network.wsUrl) : null,
    explorerBaseUrl: network.explorerBaseUrl,
    nativeSymbol: network.nativeSymbol,
    nativeDecimals: network.nativeDecimals,
    isDefault: network.isDefault,
    isArchival: network.isArchival,
    faucetEnabled: network.faucetEnabled,
    faucetDripAmount: network.faucetDripAmount,
    faucetDailyCap: network.faucetDailyCap,
    faucetCooldownSec: network.faucetCooldownSec,
    paymasterAddress: network.paymasterAddress,
    entryPointAddress: network.entryPointAddress,
    createdAt: network.createdAt.toISOString(),
    updatedAt: network.updatedAt.toISOString(),
  };
}

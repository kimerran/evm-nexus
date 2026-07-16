// Worker configuration bootstrap (AGENT.md §0/§1, SPEC §11).
//
// The worker is the ONLY process that loads the operator faucet signer key. It
// is read from env here and NEVER logged, returned, or persisted. Prisma 7 does
// not auto-load `.env`, so we load it before resolving the validated env.
import { config as loadEnv } from 'dotenv';

loadEnv();

import { getEnv } from '@nexus/config/env';
import { isHex } from 'viem';
import type { Hex } from 'viem';

/**
 * Resolve the operator faucet private key. Worker-only. Throws if unset or
 * malformed so the process fails fast rather than starting a faucet that cannot
 * sign. The value is never logged.
 */
export function getFaucetPrivateKey(): Hex {
  const key = getEnv().FAUCET_PRIVATE_KEY;
  if (!key) {
    throw new Error('FAUCET_PRIVATE_KEY is required to run the faucet-drip worker.');
  }
  if (!isHex(key) || key.length !== 66) {
    throw new Error('FAUCET_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string.');
  }
  return key;
}

/**
 * Resolve the operator RELAYER private key. Worker-only, used ONLY by the
 * bombard-runner in RELAYER mode (client mode never touches an operator key).
 * Throws if unset/malformed so a relayer run fails fast rather than mis-signing.
 * The value is never logged.
 */
export function getRelayerPrivateKey(): Hex {
  const key = getEnv().RELAYER_PRIVATE_KEY;
  if (!key) {
    throw new Error('RELAYER_PRIVATE_KEY is required to run a RELAYER-mode bombard run.');
  }
  if (!isHex(key) || key.length !== 66) {
    throw new Error('RELAYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string.');
  }
  return key;
}

/**
 * Resolve the operator PAYMASTER verifying-signer private key. Worker-only, used
 * ONLY by the `userop-sponsor` processor to sign `paymasterAndData`. Throws if
 * unset/malformed so sponsorship fails fast rather than mis-signing. The web
 * process never loads this — the sponsor route round-trips through the worker so
 * the key never leaves here. The value is never logged.
 */
export function getPaymasterSignerPrivateKey(): Hex {
  const key = getEnv().PAYMASTER_SIGNER_PRIVATE_KEY;
  if (!key) {
    throw new Error('PAYMASTER_SIGNER_PRIVATE_KEY is required to sign sponsored UserOps.');
  }
  if (!isHex(key) || key.length !== 66) {
    throw new Error('PAYMASTER_SIGNER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string.');
  }
  return key;
}

export { getEnv };

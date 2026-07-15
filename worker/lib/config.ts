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

export { getEnv };

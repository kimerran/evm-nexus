'use client';

// Client-side deploy-tx signer (AGENT.md §0/§6). BROWSER-ONLY.
//
// PRIME DIRECTIVE: the private key is used to sign ONLY here, in the browser, and
// never leaves memory. Given the UNSIGNED tx from /estimate (numeric fields as
// strings) and an in-vault private key, this produces the raw SIGNED tx the server
// broadcasts. The server never sees the key — only the raw signed payload.
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

/** The unsigned deploy tx shape returned by /api/deployments/estimate. */
export interface UnsignedDeployTx {
  type: 'eip1559';
  chainId: number;
  nonce: number;
  to: null;
  value: string;
  data: Hex;
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

/**
 * Sign an unsigned deploy tx with an in-memory private key. Numeric fields are
 * parsed to bigint (never `Number()`-ed). Returns the 0x raw signed tx.
 */
export async function signDeployTx(unsigned: UnsignedDeployTx, privateKey: Hex): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  return account.signTransaction({
    type: 'eip1559',
    chainId: unsigned.chainId,
    nonce: unsigned.nonce,
    to: undefined,
    value: BigInt(unsigned.value),
    data: unsigned.data,
    gas: BigInt(unsigned.gas),
    maxFeePerGas: BigInt(unsigned.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(unsigned.maxPriorityFeePerGas),
  });
}

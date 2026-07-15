'use client';

// Client-side chat-commit signer (AGENT.md §0/§6). BROWSER-ONLY.
//
// PRIME DIRECTIVE: the private key signs ONLY here, in the browser, and never
// leaves memory. Given the UNSIGNED `ChatLog.commit` tx from `POST /api/chat`
// and an in-vault private key, this produces the raw SIGNED tx the server
// broadcasts via `/api/chat/:id/commit`. The server never sees the key.
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

/** The unsigned commit tx shape returned by POST /api/chat. */
export interface UnsignedCommitTx {
  type: 'eip1559';
  chainId: number;
  nonce: number;
  to: Hex;
  value: string;
  data: Hex;
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

/** Sign an unsigned commit tx with an in-memory private key. Returns the raw signed tx. */
export async function signCommitTx(unsigned: UnsignedCommitTx, privateKey: Hex): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  return account.signTransaction({
    type: 'eip1559',
    chainId: unsigned.chainId,
    nonce: unsigned.nonce,
    to: unsigned.to,
    value: BigInt(unsigned.value),
    data: unsigned.data,
    gas: BigInt(unsigned.gas),
    maxFeePerGas: BigInt(unsigned.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(unsigned.maxPriorityFeePerGas),
  });
}

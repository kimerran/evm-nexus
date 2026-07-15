'use client';

// Client-side BULK bombard-tx signer (AGENT.md §0/§6). BROWSER-ONLY.
//
// PRIME DIRECTIVE: the private key is used to sign ONLY here, in the browser, and
// never leaves memory. Given the tx template + assigned nonce range from /prepare
// and an in-vault private key, this produces the array of raw SIGNED native
// transfers the server hands to the worker. The server never sees the key — only
// the raw signed payloads. Numeric fields are parsed to bigint (never floated).
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

/** The per-tx template returned by /api/bombard/prepare (client-signed mode). */
export interface BombardTxTemplate {
  chainId: number;
  to: Hex;
  /** Native value per tx, wei (decimal string). */
  value: string;
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

/** The assigned contiguous nonce range: signs `count` txs from `startNonce`. */
export interface BombardNonceRange {
  startNonce: number;
  count: number;
}

/**
 * Bulk-sign `range.count` native transfers, one per nonce, all sharing the
 * template. Returns the raw signed txs in nonce order. `onProgress` (optional)
 * reports how many have been signed so the UI can show a progress bar for large
 * batches. The private key never leaves this function.
 */
export async function signBombardTxs(
  template: BombardTxTemplate,
  range: BombardNonceRange,
  privateKey: Hex,
  onProgress?: (signed: number, total: number) => void,
): Promise<Hex[]> {
  const account = privateKeyToAccount(privateKey);
  const value = BigInt(template.value);
  const gas = BigInt(template.gas);
  const maxFeePerGas = BigInt(template.maxFeePerGas);
  const maxPriorityFeePerGas = BigInt(template.maxPriorityFeePerGas);

  const out: Hex[] = [];
  for (let i = 0; i < range.count; i += 1) {
    const raw = await account.signTransaction({
      type: 'eip1559',
      chainId: template.chainId,
      nonce: range.startNonce + i,
      to: template.to,
      value,
      data: '0x',
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });
    out.push(raw);
    if (onProgress && (i % 25 === 0 || i === range.count - 1)) onProgress(i + 1, range.count);
  }
  return out;
}

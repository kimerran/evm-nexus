'use client';

// Client-side UserOp signer (AGENT.md §0/§6). BROWSER-ONLY.
//
// PRIME DIRECTIVE: the account owner's private key is used to sign ONLY here, in
// the browser, and never leaves memory. Unlike the transfer/deploy signers (which
// sign a whole EIP-1559 tx), a sponsored UserOp is authorized by signing the
// `userOpHash` — the EntryPoint v0.7 hash the server returns from /sponsor. The
// SimpleAccount validates `owner == ecrecover(toEthSignedMessageHash(userOpHash))`,
// which is exactly viem's `LocalAccount.signMessage({ message: { raw } })`.
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

/**
 * Sign a UserOp hash with an in-memory owner private key (EIP-191 personal-sign
 * of the raw 32-byte hash — what SimpleAccount's `_validateSignature` expects).
 * Returns the 65-byte signature to attach to the UserOp before /send.
 */
export async function signUserOpHash(userOpHash: Hex, privateKey: Hex): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  return account.signMessage({ message: { raw: userOpHash } });
}

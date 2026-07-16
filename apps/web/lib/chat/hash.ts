// Pure ChatLog hashing + calldata helpers (SPEC §6/§8.8, AGENT.md §7).
//
// PURE + dependency-light (viem + committed ABI only, NO prisma) so it is shared
// by the web app AND the worker (which cannot resolve the app's `@/` alias) and
// is trivially unit-tested. The prisma-backed address store lives in chatlog.ts.
import { keccak256, stringToBytes, encodeFunctionData } from 'viem';
import type { Hex } from 'viem';
import { ChatLogAbi } from '@nexus/types';

/** AppSetting key holding a network's deployed ChatLog address. */
export function chatLogAddressKey(networkId: string): string {
  return `chat.chatLogAddress:${networkId}`;
}

/**
 * keccak256 of the off-chain message content. When an attachment is present its
 * storage key is folded into the preimage (space-separated) so the committed hash
 * covers BOTH the body and the exact attachment — recompute + compare makes a
 * tampered body OR a swapped attachment detectable on-chain.
 */
export function computeContentHash(body: string, attachmentKey: string | null): Hex {
  const preimage = attachmentKey ? `${body} ${attachmentKey}` : body;
  return keccak256(stringToBytes(preimage));
}

/** ABI-encode `ChatLog.commit(contentHash, ref)` calldata. */
export function buildCommitCalldata(contentHash: Hex, ref: string): Hex {
  return encodeFunctionData({ abi: ChatLogAbi, functionName: 'commit', args: [contentHash, ref] });
}

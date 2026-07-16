// On-chain readback of a committed message hash (SPEC §8.8 verify path).
//
// SERVER-ONLY, dependency-light (viem). Given a commit tx hash, fetch its receipt
// and decode the `MessageCommitted` event against the COMMITTED ChatLog ABI to
// recover the contentHash that is actually on-chain. The verify route recomputes
// keccak256 of the STORED body and compares — a match proves tamper-evidence, a
// mismatch proves the stored body was altered after commit.
import { decodeEventLog, getAddress } from 'viem';
import type { Hex, PublicClient } from 'viem';
import { ChatLogAbi } from '@nexus/types';

export interface OnchainCommit {
  sender: string;
  contentHash: Hex;
  timestamp: bigint;
  ref: string;
}

/**
 * Read the `MessageCommitted` event emitted by `chatLogAddress` in `txHash`.
 * Returns `null` when the receipt isn't available or no matching event exists.
 */
export async function readCommittedHash(
  client: PublicClient,
  txHash: Hex,
  chatLogAddress: string,
): Promise<OnchainCommit | null> {
  const receipt = await client.getTransactionReceipt({ hash: txHash }).catch(() => null);
  if (!receipt) return null;

  const logAddress = getAddress(chatLogAddress);
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== logAddress) continue;
    try {
      const decoded = decodeEventLog({
        abi: ChatLogAbi,
        data: log.data,
        topics: log.topics,
        eventName: 'MessageCommitted',
      });
      const args = decoded.args as unknown as {
        sender: string;
        contentHash: Hex;
        timestamp: bigint;
        ref: string;
      };
      return {
        sender: getAddress(args.sender),
        contentHash: args.contentHash,
        timestamp: args.timestamp,
        ref: args.ref,
      };
    } catch {
      // Not a MessageCommitted log from ChatLog — skip.
    }
  }
  return null;
}

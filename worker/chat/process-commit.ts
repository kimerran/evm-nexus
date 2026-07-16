// chat-commit processor — the operator-RELAYED alternative to a client-signed
// commit (SPEC §8.8/§9, AGENT.md §0/§5).
//
// This is the ONLY place the operator RELAYER key signs a chat commit — never the
// web app (prime directive). Guarantees:
//   • Idempotent by messageId — only PENDING rows without a txHash are processed;
//     a retry / duplicate is a no-op.
//   • Budget-capped — a rolling per-day Redis counter caps how many commits the
//     operator will fund; over budget → the row is marked FAILED, no spend.
//   • Chain safety — the live chainId is verified to equal the configured one
//     BEFORE any broadcast; the commit is non-payable (value 0).
//   • Secrets — only ids / statuses / tx HASHES are logged; never the key.
import { getAddress } from 'viem';
import { prisma } from '../lib/prisma';
import { getConnection, acquireLock, releaseLock } from '../lib/redis';
import { loadNetworkBasic, buildRelayerClients } from '../lib/chain';
import { buildCommitCalldata, chatLogAddressKey } from '../../apps/web/lib/chat/hash';
import {
  chatRelayerBudgetKey,
  CHAT_RELAYER_DAILY_CAP_SETTING,
  DEFAULT_CHAT_RELAYER_DAILY_CAP,
} from '../../apps/web/lib/chat/keys';

/** Read a network's deployed ChatLog address from AppSetting (worker prisma). */
async function getChatLogAddress(networkId: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: chatLogAddressKey(networkId) } });
  const value = row?.value as { address?: unknown } | null | undefined;
  return value && typeof value.address === 'string' ? value.address : null;
}

const LOCK_TTL_MS = 30_000;
const BUDGET_TTL_SEC = 26 * 60 * 60; // slightly over a day so the rolling key expires

export interface ChatCommitResult {
  messageId: string;
  status: string;
  txHash?: string;
  note?: string;
}

async function relayerDailyCap(): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: CHAT_RELAYER_DAILY_CAP_SETTING } });
  const raw = row?.value;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw;
  return DEFAULT_CHAT_RELAYER_DAILY_CAP;
}

/** Process one chat-commit relayer job. Safe to call repeatedly for the same id. */
export async function processChatCommit(messageId: string): Promise<ChatCommitResult> {
  const row = await prisma.chatMessage.findUnique({ where: { id: messageId } });
  if (!row) throw new Error(`ChatMessage ${messageId} not found`);
  if (row.txHash || row.status !== 'PENDING') {
    return { messageId, status: row.status, note: 'already-processed' };
  }

  const lockKey = `chat:commit:lock:${messageId}`;
  const token = await acquireLock(lockKey, LOCK_TTL_MS);
  if (!token) throw new Error(`chat commit lock busy for ${messageId}`);

  try {
    const fresh = await prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!fresh || fresh.txHash || fresh.status !== 'PENDING') {
      return { messageId, status: fresh?.status ?? 'GONE', note: 'already-processed' };
    }

    // Budget gate — atomic INCR against the rolling daily counter.
    const cap = await relayerDailyCap();
    const budgetKey = chatRelayerBudgetKey();
    const used = await getConnection().incr(budgetKey);
    if (used === 1) await getConnection().expire(budgetKey, BUDGET_TTL_SEC);
    if (used > cap) {
      await getConnection().decr(budgetKey); // give the slot back; we didn't spend
      await prisma.chatMessage.update({ where: { id: messageId }, data: { status: 'FAILED' } });
      return { messageId, status: 'FAILED', note: 'relayer-budget-exceeded' };
    }

    const network = await loadNetworkBasic(fresh.networkId);
    if (!network) throw new Error(`network ${fresh.networkId} not found`);

    const chatLogAddress = await getChatLogAddress(fresh.networkId);
    if (!chatLogAddress) {
      await prisma.chatMessage.update({ where: { id: messageId }, data: { status: 'FAILED' } });
      return { messageId, status: 'FAILED', note: 'chatlog-not-deployed' };
    }

    const { account, publicClient, walletClient } = buildRelayerClients(network);
    const liveChainId = await publicClient.getChainId();
    if (liveChainId !== network.chainId) {
      await prisma.chatMessage.update({ where: { id: messageId }, data: { status: 'FAILED' } });
      throw new Error(`chainId mismatch: live ${liveChainId} != configured ${network.chainId}`);
    }

    const data = buildCommitCalldata(fresh.contentHash as `0x${string}`, fresh.id);

    await prisma.chatMessage.update({ where: { id: messageId }, data: { status: 'BROADCAST' } });
    const hash = await walletClient.sendTransaction({
      account,
      to: getAddress(chatLogAddress),
      value: 0n,
      data,
    });
    await prisma.chatMessage.update({
      where: { id: messageId },
      data: { status: 'CONFIRMING', txHash: hash },
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const ok = receipt.status === 'success';
    await prisma.chatMessage.update({
      where: { id: messageId },
      data: { status: ok ? 'SUCCESS' : 'FAILED' },
    });
    return { messageId, status: ok ? 'SUCCESS' : 'FAILED', txHash: hash };
  } finally {
    await releaseLock(lockKey, token);
  }
}

// On-chain chat integration test (SPEC §8.8/§17, AGENT.md §8).
//
// Stores a message off-chain, commits its keccak256 content hash on-chain via the
// deployed ChatLog (client-signed), watches the receipt, and asserts BOTH the
// ChatMessage row reaching SUCCESS AND the on-chain `MessageCommitted` event
// matching the recomputed hash (verify → verified:true). The failure path mutates
// the stored body AFTER commit and proves verify flips to tampered — exactly the
// tamper-evidence the feature promises.
//
// Requires the ChatLog to be deployed on the active network:
//   pnpm tsx apps/web/scripts/deploy-chatlog.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as chatCreate } from '@/app/api/chat/route';
import { POST as chatCommit } from '@/app/api/chat/[id]/commit/route';
import { GET as chatVerify } from '@/app/api/chat/[id]/verify/route';
import { getChatLogAddress } from '@/lib/chat/chatlog';
import { processChatCommitWatch } from '../../../../worker/tx/process-watch';
import {
  apiRequest,
  mintApiKey,
  getAdminUserId,
  getDefaultNetwork,
  testSigner2,
  teardownConnections,
} from './helpers';

interface UnsignedCommitTx {
  chainId: number;
  nonce: number;
  to: `0x${string}`;
  data: `0x${string}`;
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

let token: string;
let networkId: string;

beforeAll(async () => {
  token = await mintApiKey(await getAdminUserId());
  networkId = (await getDefaultNetwork()).id;
  const chatLog = await getChatLogAddress(networkId);
  if (!chatLog) {
    throw new Error('ChatLog not deployed — run `pnpm tsx apps/web/scripts/deploy-chatlog.ts`');
  }
});

afterAll(async () => {
  await teardownConnections();
});

async function commitMessage(bodyText: string): Promise<string> {
  // 1) Store off-chain + get the unsigned commit tx.
  const createRes = await chatCreate(
    apiRequest('/api/chat', {
      token,
      body: { networkId, from: testSigner2.address, body: bodyText },
    }),
  );
  expect(createRes.status).toBe(201);
  const { data } = (await createRes.json()) as {
    data: { messageId: string; commitDraftId: string; unsignedCommitTx: UnsignedCommitTx };
  };
  const { messageId, commitDraftId, unsignedCommitTx: tx } = data;

  // 2) Client signs the commit tx (server never sees the key).
  const rawSignedTx = await testSigner2.signTransaction({
    type: 'eip1559',
    chainId: tx.chainId,
    nonce: tx.nonce,
    to: tx.to,
    value: 0n,
    data: tx.data,
    gas: BigInt(tx.gas),
    maxFeePerGas: BigInt(tx.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
  });

  // 3) Broadcast + watch the receipt.
  const commitRes = await chatCommit(
    apiRequest(`/api/chat/${messageId}/commit`, {
      token,
      body: { mode: 'client-signed', commitDraftId, rawSignedTx },
    }),
    { params: Promise.resolve({ id: messageId }) },
  );
  expect(commitRes.status).toBe(202);

  const watch = await processChatCommitWatch(messageId, { finalAttempt: true });
  expect(watch.status).toBe('SUCCESS');
  return messageId;
}

async function verify(messageId: string) {
  const res = await chatVerify(apiRequest(`/api/chat/${messageId}/verify`, { token, method: 'GET' }), {
    params: Promise.resolve({ id: messageId }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: { verified: boolean; onchainHash: string } }).data;
}

describe('on-chain chat commit + verify (integration)', () => {
  it('commits a hash on-chain and verify passes against the MessageCommitted event', async () => {
    const messageId = await commitMessage('gm nexus — committed on-chain');
    const row = await prisma.chatMessage.findUnique({ where: { id: messageId } });
    expect(row?.status).toBe('SUCCESS');
    expect(row?.txHash).toMatch(/^0x[0-9a-f]{64}$/i);

    const result = await verify(messageId);
    expect(result.verified).toBe(true);
    expect(result.onchainHash.toLowerCase()).toBe(row?.contentHash.toLowerCase());
  });

  it('flags a message whose stored body was altered after commit as tampered (failure path)', async () => {
    const messageId = await commitMessage('original message body');

    // Tamper: rewrite the stored body AFTER the hash was committed on-chain.
    await prisma.chatMessage.update({
      where: { id: messageId },
      data: { body: 'MALICIOUSLY ALTERED body' },
    });

    const result = await verify(messageId);
    expect(result.verified).toBe(false);
  });
});

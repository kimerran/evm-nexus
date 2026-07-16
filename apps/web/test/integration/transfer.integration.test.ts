// Native transfer integration test (SPEC §8.6/§17, AGENT.md §8).
//
// Drives prepare → client-sign → broadcast → tx-watch against the live anvil chain
// and asserts BOTH the Transfer row reaching SUCCESS AND the recipient's on-chain
// balance growing by the sent amount. Failure path: a tx signed by the wrong key
// is rejected at broadcast (signer != sender) and never lands.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseEther } from 'viem';
import { prisma } from '@/lib/db';
import { POST as prepare } from '@/app/api/transfers/prepare/route';
import { POST as broadcast } from '@/app/api/transfers/broadcast/route';
import { processTxWatch } from '../../../../worker/tx/process-watch';
import {
  apiRequest,
  mintApiKey,
  getAdminUserId,
  getDefaultNetwork,
  anvilPublicClient,
  testSigner,
  testSigner2,
  teardownConnections,
} from './helpers';

interface UnsignedTx {
  chainId: number;
  nonce: number;
  to: `0x${string}`;
  value: string;
  data: `0x${string}`;
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

const RECIPIENT = '0x000000000000000000000000000000000000dEaD';
let token: string;
let networkId: string;

beforeAll(async () => {
  token = await mintApiKey(await getAdminUserId());
  networkId = (await getDefaultNetwork()).id;
});

afterAll(async () => {
  await teardownConnections();
});

async function prepareNative(amountWei: bigint): Promise<{ unsignedTx: UnsignedTx; draftId: string }> {
  const res = await prepare(
    apiRequest('/api/transfers/prepare', {
      token,
      body: {
        kind: 'NATIVE',
        networkId,
        from: testSigner.address,
        to: RECIPIENT,
        amount: amountWei.toString(),
      },
    }),
  );
  expect(res.status).toBe(200);
  const { data } = (await res.json()) as {
    data: { unsignedTx: UnsignedTx; transferDraftId: string };
  };
  return { unsignedTx: data.unsignedTx, draftId: data.transferDraftId };
}

function sign(tx: UnsignedTx, signer: typeof testSigner): Promise<`0x${string}`> {
  return signer.signTransaction({
    type: 'eip1559',
    chainId: tx.chainId,
    nonce: tx.nonce,
    to: tx.to,
    value: BigInt(tx.value),
    data: tx.data,
    gas: BigInt(tx.gas),
    maxFeePerGas: BigInt(tx.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
  });
}

describe('native transfer (integration)', () => {
  it('sends native value: Transfer row → SUCCESS and recipient balance grows', async () => {
    const amountWei = parseEther('0.25');
    const publicClient = await anvilPublicClient();
    const before = await publicClient.getBalance({ address: RECIPIENT });

    const { unsignedTx, draftId } = await prepareNative(amountWei);
    const rawSignedTx = await sign(unsignedTx, testSigner);

    const res = await broadcast(
      apiRequest('/api/transfers/broadcast', {
        token,
        body: { networkId, transferDraftId: draftId, rawSignedTx },
      }),
    );
    // Surface the server reason if the broadcast was rejected.
    if (res.status !== 202) {
      const body = (await res.clone().json()) as { error?: { message: string } };
      throw new Error(`broadcast ${res.status}: ${body.error?.message ?? 'unknown'}`);
    }
    const { data } = (await res.json()) as { data: { transferId: string } };

    const watch = await processTxWatch(data.transferId, { finalAttempt: true });
    expect(watch.status).toBe('SUCCESS');

    const row = await prisma.transfer.findUnique({ where: { id: data.transferId } });
    expect(row?.status).toBe('SUCCESS');

    const after = await publicClient.getBalance({ address: RECIPIENT });
    expect(after - before).toBe(amountWei);
  });

  it('rejects a transfer signed by the wrong key (failure path)', async () => {
    const { unsignedTx, draftId } = await prepareNative(parseEther('0.1'));
    const rawSignedTx = await sign(unsignedTx, testSigner2); // wrong signer

    const res = await broadcast(
      apiRequest('/api/transfers/broadcast', {
        token,
        body: { networkId, transferDraftId: draftId, rawSignedTx },
      }),
    );
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: { message: string } };
    expect(error.message).toMatch(/signer|sender/i);
  });
});

// Faucet integration test (SPEC §8.4/§17, AGENT.md §8).
//
// Exercises the REAL route handler → real Postgres row → real BullMQ producer,
// then runs the worker's drip processor against the live anvil chain and asserts
// BOTH sides of the ledger: the FaucetRequest row reaches SUCCESS with a tx hash
// AND the recipient's on-chain balance grew by exactly the drip amount. The
// failure path proves an over-ceiling request is rejected at the boundary and
// never spends.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseEther } from 'viem';
import { prisma } from '@/lib/db';
import { POST as faucetRequest } from '@/app/api/faucet/request/route';
import { processFaucetDrip } from '../../../../worker/faucet/process-drip';
import {
  apiRequest,
  mintApiKey,
  getAdminUserId,
  getDefaultNetwork,
  anvilPublicClient,
  teardownConnections,
} from './helpers';

// A fresh random recipient per run so its balance starts at a known-zero baseline
// and no prior drip counts against the cooldown/daily cap.
function randomAddress(): `0x${string}` {
  const hex = Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `0x${hex}` as `0x${string}`;
}

let token: string;
let networkId: string;

beforeAll(async () => {
  token = await mintApiKey(await getAdminUserId());
  networkId = (await getDefaultNetwork()).id;
});

afterAll(async () => {
  await teardownConnections();
});

describe('faucet drip (integration)', () => {
  it('drips native ETH: DB row → SUCCESS and on-chain balance grows by the amount', async () => {
    const to = randomAddress();
    const amountWei = parseEther('1');
    const publicClient = await anvilPublicClient();

    const balanceBefore = await publicClient.getBalance({ address: to });
    expect(balanceBefore).toBe(0n);

    // 1) Route handler creates the row + enqueues the drip.
    const res = await faucetRequest(
      apiRequest('/api/faucet/request', {
        token,
        body: { toAddress: to, amount: amountWei.toString(), networkId },
      }),
    );
    expect(res.status).toBe(202);
    const payload = ((await res.json()) as { data: { requestId: string; status: string } }).data;
    expect(payload.status).toBe('QUEUED');

    const queued = await prisma.faucetRequest.findUnique({ where: { id: payload.requestId } });
    expect(queued?.status).toBe('PENDING');

    // 2) Worker processes the drip against anvil (the ONLY place the signer key lives).
    const result = await processFaucetDrip(payload.requestId);
    expect(result.status).toBe('SUCCESS');
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/i);

    // 3) DB row finalized...
    const row = await prisma.faucetRequest.findUnique({ where: { id: payload.requestId } });
    expect(row?.status).toBe('SUCCESS');
    expect(row?.txHash).toBe(result.txHash);

    // 4) ...and the on-chain balance grew by exactly the drip amount.
    const balanceAfter = await publicClient.getBalance({ address: to });
    expect(balanceAfter - balanceBefore).toBe(amountWei);
  });

  it('rejects an over-ceiling drip at the boundary and never spends (failure path)', async () => {
    const to = randomAddress();
    const network = await getDefaultNetwork();
    // One wei past the per-request cap.
    const overCap = (BigInt(network.faucetDripAmount) + 1n).toString();

    const res = await faucetRequest(
      apiRequest('/api/faucet/request', { token, body: { toAddress: to, amount: overCap, networkId } }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    // No SUCCESS row was created for this recipient, and nothing was sent on-chain.
    const rows = await prisma.faucetRequest.findMany({ where: { toAddress: to } });
    expect(rows.every((r) => r.status !== 'SUCCESS')).toBe(true);
    const publicClient = await anvilPublicClient();
    expect(await publicClient.getBalance({ address: to })).toBe(0n);
  });
});

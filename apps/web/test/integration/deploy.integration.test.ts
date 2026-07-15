// ERC-20 deploy integration test (SPEC §8.5/§17, AGENT.md §8).
//
// Drives the real estimate → client-sign → broadcast → watch pipeline against the
// live anvil chain and asserts BOTH the Deployment row reaching SUCCESS with a
// contractAddress AND real bytecode existing at that address on-chain. The signer
// stands in for the in-browser vault key (the server never sees a private key —
// it only ever receives a raw SIGNED tx). The failure path proves the broadcast
// guard rejects a tx signed by anyone other than the pinned deploy owner.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseEther } from 'viem';
import { prisma } from '@/lib/db';
import { POST as estimate } from '@/app/api/deployments/estimate/route';
import { POST as broadcast } from '@/app/api/deployments/broadcast/route';
import { processDeployWatch } from '../../../../worker/deploy/process-watch';
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
});

afterAll(async () => {
  await teardownConnections();
});

async function estimateErc20(): Promise<{ unsignedTx: UnsignedTx; deploymentDraftId: string }> {
  const res = await estimate(
    apiRequest('/api/deployments/estimate', {
      token,
      body: {
        standard: 'ERC20',
        networkId,
        ownerAddress: testSigner.address,
        name: 'Nexus Gold',
        symbol: 'NXG',
        initialSupply: parseEther('1000').toString(),
        features: { mintable: true, burnable: true, pausable: false, permit: false },
      },
    }),
  );
  expect(res.status).toBe(200);
  const { data } = (await res.json()) as {
    data: { unsignedTx: UnsignedTx; deploymentDraftId: string };
  };
  return data;
}

function signDeploy(tx: UnsignedTx, signer: typeof testSigner): Promise<`0x${string}`> {
  return signer.signTransaction({
    type: 'eip1559',
    chainId: tx.chainId,
    nonce: tx.nonce,
    data: tx.data,
    value: 0n,
    gas: BigInt(tx.gas),
    maxFeePerGas: BigInt(tx.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
  });
}

describe('ERC-20 deploy (integration)', () => {
  it('deploys a client-signed ERC-20: DB row → SUCCESS and bytecode exists on-chain', async () => {
    const { unsignedTx, deploymentDraftId } = await estimateErc20();
    const rawSignedTx = await signDeploy(unsignedTx, testSigner);

    const res = await broadcast(
      apiRequest('/api/deployments/broadcast', {
        token,
        body: { networkId, deploymentDraftId, rawSignedTx },
      }),
    );
    expect(res.status).toBe(202);
    const { data } = (await res.json()) as { data: { deploymentId: string; txHash: string } };

    const result = await processDeployWatch(data.deploymentId, { finalAttempt: true });
    expect(result.status).toBe('SUCCESS');
    expect(result.contractAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const row = await prisma.deployment.findUnique({ where: { id: data.deploymentId } });
    expect(row?.status).toBe('SUCCESS');
    expect(row?.contractAddress).toBe(result.contractAddress);

    // On-chain effect: the deployed contract has real runtime bytecode.
    const publicClient = await anvilPublicClient();
    const code = await publicClient.getCode({ address: result.contractAddress as `0x${string}` });
    expect(code).toBeTruthy();
    expect(code).not.toBe('0x');
  });

  it('rejects a deploy signed by someone other than the pinned owner (failure path)', async () => {
    const { unsignedTx, deploymentDraftId } = await estimateErc20();
    // Same authorized calldata, but signed by the WRONG key.
    const rawSignedTx = await signDeploy(unsignedTx, testSigner2);

    const res = await broadcast(
      apiRequest('/api/deployments/broadcast', {
        token,
        body: { networkId, deploymentDraftId, rawSignedTx },
      }),
    );
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: { message: string } };
    expect(error.message).toMatch(/signer|owner/i);
  });
});

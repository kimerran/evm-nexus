// userop-bundler processor — submits a signed, sponsored UserOp to the EntryPoint
// (SPEC §8.9/§9, AGENT.md §5).
//
// Self-bundling: no external bundler service. This is the ONLY place the RELAYER
// key is loaded for the 4337 path. It re-enforces the per-op paymaster budget cap
// (defence-in-depth with the /sponsor route), submits `handleOps([op], relayer)`,
// waits for the receipt, decodes the EntryPoint `UserOperationEvent` to learn
// whether the op itself succeeded and its actual gas cost, finalizes the Transfer
// row, flips SmartAccount.isDeployed when the account now has code, and publishes
// a live tx event. Idempotent by transferId — a terminal row is a no-op. Only ids
// / statuses / tx HASHES / addresses are logged, never the key.
import { getContract, decodeEventLog, getAddress } from 'viem';
import type { Hex, Log } from 'viem';
import { EntryPointAbi } from '@nexus/types';
import { prisma } from '../lib/prisma';
import { getConnection } from '../lib/redis';
import {
  loadNetworkBasic,
  buildPublicClientForNetwork,
  buildRelayerClients,
  loadStack,
} from '../lib/chain';
import { toPacked, userOpMaxCostWei } from '../../apps/web/lib/smart-wallets/userop';
import { USEROP_MAX_OP_COST_WEI_SETTING } from '../../apps/web/lib/smart-wallets/keys';
import type { UserOpBundlerJobData } from '../../apps/web/lib/smart-wallets/keys';
import { TELEMETRY_CHANNELS } from '../../apps/web/lib/telemetry/sse';
import type { TxTelemetryEvent } from '../../apps/web/lib/telemetry/tx-event';

const RECEIPT_WAIT_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;
const TERMINAL = new Set(['SUCCESS', 'FAILED', 'REJECTED']);

export interface UserOpBundleResult {
  transferId: string;
  status: string;
  txHash?: string | null;
  userOpSuccess?: boolean;
  actualGasCost?: string;
  note?: string;
}

async function publish(event: TxTelemetryEvent): Promise<void> {
  try {
    await getConnection().publish(TELEMETRY_CHANNELS.tx, JSON.stringify(event));
  } catch {
    // telemetry must never break finalization
  }
}

/** Load the per-op paymaster cost cap (wei) for the hard re-check. */
async function loadMaxOpCostWei(): Promise<bigint> {
  const row = await prisma.appSetting.findUnique({ where: { key: USEROP_MAX_OP_COST_WEI_SETTING } });
  const v = row?.value;
  if (typeof v === 'string' && /^[0-9]+$/.test(v)) return BigInt(v);
  return 100_000_000_000_000_000n; // 0.1 ETH default
}

/** Submit + finalize one sponsored UserOp. Safe to call repeatedly for the same id. */
export async function processUserOpBundle(data: UserOpBundlerJobData): Promise<UserOpBundleResult> {
  const { transferId, userOp } = data;

  const row = await prisma.transfer.findUnique({ where: { id: transferId } });
  if (!row) throw new Error(`Transfer ${transferId} not found`);
  if (TERMINAL.has(row.status)) {
    return { transferId, status: row.status, note: 'already-finalized' };
  }

  // Hard budget re-check (defence-in-depth with the /sponsor route reservation).
  const maxOpCostWei = await loadMaxOpCostWei();
  const opCost = userOpMaxCostWei(userOp);
  if (opCost > maxOpCostWei) {
    await prisma.transfer.update({
      where: { id: transferId },
      data: { status: 'REJECTED', errorMessage: 'UserOp exceeds the paymaster per-op budget cap.' },
    });
    return { transferId, status: 'REJECTED', note: 'budget-cap' };
  }

  const network = await loadNetworkBasic(row.networkId);
  if (!network) throw new Error(`network ${row.networkId} not found`);
  const stack = await loadStack(row.networkId);
  if (!stack) throw new Error(`ERC-4337 stack not deployed on network ${row.networkId}`);

  const publicClient = buildPublicClientForNetwork(network);
  const { account, walletClient } = buildRelayerClients(network);

  // Guard chainId before any submit.
  const liveChainId = await publicClient.getChainId();
  if (liveChainId !== network.chainId) {
    throw new Error(`chainId mismatch: live ${liveChainId} != configured ${network.chainId}`);
  }

  const packed = toPacked(userOp);

  if (row.status === 'PENDING') {
    await prisma.transfer.update({ where: { id: transferId }, data: { status: 'CONFIRMING' } });
  }

  const entryPoint = getContract({
    address: stack.entryPoint,
    abi: EntryPointAbi,
    client: walletClient,
  });

  const txHash = (await entryPoint.write.handleOps([[packed], account.address], {
    account,
    chain: walletClient.chain,
  })) as Hex;

  await prisma.transfer.update({ where: { id: transferId }, data: { txHash } });

  const receipt = await publicClient
    .waitForTransactionReceipt({ hash: txHash, timeout: RECEIPT_WAIT_MS, pollingInterval: POLL_INTERVAL_MS })
    .catch(() => null);

  const baseEvent = {
    id: row.id,
    kind: row.kind,
    fromAddress: row.fromAddress,
    toAddress: row.toAddress,
    tokenAddress: row.tokenAddress,
    tokenId: row.tokenId,
    amount: row.amount,
    txHash,
  };

  if (!receipt) {
    await prisma.transfer.update({
      where: { id: transferId },
      data: { status: 'FAILED', errorMessage: 'Timed out waiting for handleOps receipt.' },
    });
    await publish({ ...baseEvent, status: 'FAILED', at: new Date().toISOString() });
    return { transferId, status: 'FAILED', txHash, note: 'receipt-timeout' };
  }

  // Decode the EntryPoint UserOperationEvent to learn the op's real outcome:
  // the handleOps tx can succeed while the UserOp itself reverts.
  const { userOpSuccess, actualGasCost } = decodeUserOpEvent(receipt.logs, stack.entryPoint);
  const success = receipt.status === 'success' && userOpSuccess !== false;

  await prisma.transfer.update({
    where: { id: transferId },
    data: {
      status: success ? 'SUCCESS' : 'FAILED',
      errorMessage: success ? null : 'Sponsored UserOp reverted.',
    },
  });

  // Flip SmartAccount.isDeployed when the account now has code.
  if (success) {
    const code = await publicClient.getCode({ address: row.fromAddress as Hex }).catch(() => undefined);
    if (code && code !== '0x') {
      await prisma.smartAccount.updateMany({
        where: { networkId: row.networkId, accountAddress: getAddress(row.fromAddress) },
        data: { isDeployed: true },
      });
    }
  }

  await publish({ ...baseEvent, status: success ? 'SUCCESS' : 'FAILED', at: new Date().toISOString() });

  return {
    transferId,
    status: success ? 'SUCCESS' : 'FAILED',
    txHash,
    userOpSuccess,
    actualGasCost: actualGasCost?.toString(),
  };
}

/** Decode the first EntryPoint UserOperationEvent from a receipt's logs. */
function decodeUserOpEvent(
  logs: readonly Log[],
  entryPoint: string,
): { userOpSuccess?: boolean; actualGasCost?: bigint } {
  const ep = entryPoint.toLowerCase();
  for (const log of logs) {
    if (log.address.toLowerCase() !== ep) continue;
    try {
      const decoded = decodeEventLog({ abi: EntryPointAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === 'UserOperationEvent') {
        const args = decoded.args as unknown as { success: boolean; actualGasCost: bigint };
        return { userOpSuccess: args.success, actualGasCost: args.actualGasCost };
      }
    } catch {
      // not the event we're after
    }
  }
  return {};
}

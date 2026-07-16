// LIVE end-to-end proof of the sponsored ERC-4337 flow (SPEC §8.9 DoD).
//
// Exercises the REAL HTTP routes + worker against anvil, authenticating as the
// seeded admin with a freshly-minted API key (Bearer — no browser/CSRF needed).
// The owner is an anvil EOA that stands in for the in-browser vault key: it signs
// ONLY the userOpHash, exactly as the /smart-wallets page will. It proves:
//   • predicted address == deployed address
//   • a sponsored UserOp deploys the account (initCode) AND runs an inner call
//   • the owner EOA pays ZERO gas (balance unchanged; paymaster deposit drops)
//   • the budget cap rejects an over-limit sponsor request
//
// Prereqs (run separately): anvil @ 8545, `next dev -p 3900`, `pnpm worker`, and
// `pnpm tsx apps/web/scripts/deploy-4337.ts` (stack deployed).
import { config as loadEnv } from 'dotenv';
loadEnv();

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  getAddress,
  parseEther,
  formatEther,
} from 'viem';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PrismaPg } from '@prisma/adapter-pg';
import { getEnv } from '@nexus/config/env';
import { EntryPointAbi } from '@nexus/types';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '../lib/generated/prisma/client';
import { USEROP_MAX_OP_COST_WEI_SETTING, stackSettingKey } from '../lib/smart-wallets/keys';

// Inlined here (not imported) so this script pulls in NO `@/`-aliased module that
// reads env at import time — dotenv must load before any getEnv() runs.
function generateApiKey(): { token: string; keyHash: string; prefix: string } {
  const token = `nxs_${randomBytes(32).toString('base64url')}`;
  return { token, keyHash: createHash('sha256').update(token).digest('hex'), prefix: token.slice(0, 12) };
}

interface Stack {
  entryPoint: Address;
  factory: Address;
  paymaster: Address;
  paymasterSigner: Address;
}

const BASE = process.env.PROVE_BASE_URL ?? 'http://localhost:3900';
// anvil funded accounts: #0 pays for funding; #6 is the smart-account OWNER.
const FUNDER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const OWNER_KEY = '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e' as Hex;
const RECIPIENT = getAddress('0x000000000000000000000000000000000000dEaD');
const INNER_VALUE = parseEther('0.1');

interface Api {
  json: <T>(path: string, body: unknown) => Promise<{ status: number; data: T; error?: { message: string } }>;
  get: <T>(path: string) => Promise<{ status: number; data: T }>;
}

function makeApi(token: string): Api {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  return {
    async json(path, body) {
      const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
      const payload = (await res.json()) as { data?: unknown; error?: { message: string } };
      return { status: res.status, data: payload.data as never, error: payload.error };
    },
    async get(path) {
      const res = await fetch(`${BASE}${path}`, { headers });
      const payload = (await res.json()) as { data?: unknown };
      return { status: res.status, data: payload.data as never };
    },
  };
}

async function main(): Promise<void> {
  const env = getEnv();
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const network = await prisma.network.findFirst({ where: { isDefault: true } });
    if (!network) throw new Error('No active network.');
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!admin) throw new Error('No admin user — seed first.');
    const stackRow = await prisma.appSetting.findUnique({ where: { key: stackSettingKey(network.id) } });
    if (!stackRow) throw new Error('4337 stack not deployed — run deploy-4337.ts.');
    const stack = stackRow.value as unknown as Stack;

    // Mint a throwaway API key for the admin.
    const key = generateApiKey();
    await prisma.apiKey.create({
      data: { userId: admin.id, name: 'prove-4337', keyHash: key.keyHash, prefix: key.prefix },
    });
    const api = makeApi(key.token);

    const chain = defineChain({
      id: network.chainId,
      name: network.name,
      nativeCurrency: { name: network.nativeSymbol, symbol: network.nativeSymbol, decimals: 18 },
      rpcUrls: { default: { http: [network.rpcUrl] } },
    });
    const publicClient = createPublicClient({ chain, transport: http(network.rpcUrl) });
    const funder = privateKeyToAccount(FUNDER_KEY);
    const funderWallet = createWalletClient({ account: funder, chain, transport: http(network.rpcUrl) });
    const owner = privateKeyToAccount(OWNER_KEY);
    const salt = Date.now().toString();

    const entryPointDeposit = (addr: Address) =>
      publicClient.readContract({ address: stack.entryPoint, abi: EntryPointAbi, functionName: 'balanceOf', args: [addr] }) as Promise<bigint>;

    console.log('\n=== ERC-4337 sponsored UserOp — LIVE PROOF ===');
    console.log(`network       ${network.name} (chainId ${network.chainId})`);
    console.log(`entryPoint    ${stack.entryPoint}`);
    console.log(`factory       ${stack.factory}`);
    console.log(`paymaster     ${stack.paymaster}`);
    console.log(`owner (EOA)   ${owner.address}`);
    console.log(`salt          ${salt}`);

    // 1. Predict the counterfactual address.
    const predict = await api.json<{ accountAddress: Address; isDeployed: boolean }>(
      '/api/smart-accounts/predict',
      { ownerAddress: owner.address, salt },
    );
    if (predict.status !== 200) throw new Error(`predict failed: ${predict.error?.message}`);
    const predicted = getAddress(predict.data.accountAddress);
    console.log(`\n[predict]     accountAddress = ${predicted} (isDeployed=${predict.data.isDeployed})`);

    const codeBefore = await publicClient.getCode({ address: predicted });
    console.log(`[predict]     code before    = ${codeBefore ?? '0x'} (counterfactual)`);

    // Pre-fund the smart ACCOUNT (not the owner) so its inner native transfer works.
    const fundHash = await funderWallet.sendTransaction({ account: funder, to: predicted, value: parseEther('1'), chain });
    await publicClient.waitForTransactionReceipt({ hash: fundHash });
    console.log(`[fund]        funded smart account with 1 ETH (paid by funder, not owner)`);

    // Snapshot balances BEFORE.
    const ownerBefore = await publicClient.getBalance({ address: owner.address });
    const recipientBefore = await publicClient.getBalance({ address: RECIPIENT });
    const pmDepositBefore = await entryPointDeposit(stack.paymaster);
    console.log(`\n[before]      owner EOA balance      = ${formatEther(ownerBefore)} ETH`);
    console.log(`[before]      recipient balance      = ${formatEther(recipientBefore)} ETH`);
    console.log(`[before]      paymaster EP deposit   = ${formatEther(pmDepositBefore)} ETH`);

    // 2. Sponsor: scaffold + paymaster signs (via worker).
    const sponsor = await api.json<{ userOp: Record<string, unknown> & { signature: Hex }; userOpHash: Hex; maxCostWei: string }>(
      '/api/userops/sponsor',
      { ownerAddress: owner.address, salt, call: { to: RECIPIENT, value: INNER_VALUE.toString(), data: '0x' } },
    );
    if (sponsor.status !== 200) throw new Error(`sponsor failed (${sponsor.status}): ${sponsor.error?.message}`);
    console.log(`\n[sponsor]     userOpHash = ${sponsor.data.userOpHash}`);
    console.log(`[sponsor]     paymaster signed; max sponsored cost = ${formatEther(BigInt(sponsor.data.maxCostWei))} ETH`);

    // 3. Owner signs the userOpHash in-browser-equivalent (raw personal-sign).
    const signature = await owner.signMessage({ message: { raw: sponsor.data.userOpHash } });
    const signedUserOp = { ...sponsor.data.userOp, signature };

    // 4. Send: enqueue the bundler (relayer submits handleOps).
    const send = await api.json<{ transferId: string }>('/api/userops/send', {
      userOp: signedUserOp,
    });
    if (send.status !== 202) throw new Error(`send failed (${send.status}): ${send.error?.message}`);
    const transferId = send.data.transferId;
    console.log(`\n[send]        transferId = ${transferId} (queued to userop-bundler)`);

    // 5. Poll the Transfer to terminal status.
    let status = 'PENDING';
    let txHash: string | null = null;
    for (let i = 0; i < 40; i++) {
      const row = await prisma.transfer.findUnique({ where: { id: transferId } });
      if (row) {
        status = row.status;
        txHash = row.txHash;
        if (['SUCCESS', 'FAILED', 'REJECTED'].includes(status)) break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.log(`[bundler]     status = ${status}, userOp tx = ${txHash}`);
    if (status !== 'SUCCESS') throw new Error(`UserOp did not land (status=${status}).`);

    // 6. Verify outcomes.
    const codeAfter = await publicClient.getCode({ address: predicted });
    const ownerAfter = await publicClient.getBalance({ address: owner.address });
    const recipientAfter = await publicClient.getBalance({ address: RECIPIENT });
    const pmDepositAfter = await entryPointDeposit(stack.paymaster);

    console.log(`\n=== RESULTS ===`);
    console.log(`predicted == deployed : ${predicted} ; code now ${codeAfter && codeAfter !== '0x' ? 'PRESENT' : 'ABSENT'}`);
    console.log(`inner call executed   : recipient ${formatEther(recipientBefore)} -> ${formatEther(recipientAfter)} ETH (+${formatEther(recipientAfter - recipientBefore)})`);
    console.log(`owner EOA gas paid    : ${formatEther(ownerBefore)} -> ${formatEther(ownerAfter)} ETH (delta ${formatEther(ownerAfter - ownerBefore)})`);
    console.log(`paymaster deposit     : ${formatEther(pmDepositBefore)} -> ${formatEther(pmDepositAfter)} ETH (delta ${formatEther(pmDepositAfter - pmDepositBefore)})`);

    const ok =
      codeAfter !== undefined && codeAfter !== '0x' &&
      recipientAfter - recipientBefore === INNER_VALUE &&
      ownerAfter === ownerBefore &&
      pmDepositAfter < pmDepositBefore;
    console.log(`\nALL INVARIANTS: ${ok ? 'PASS ✅' : 'FAIL ❌'}`);
    if (!ok) throw new Error('sponsored UserOp invariants not satisfied');

    // 7. Budget cap rejection: shrink the per-op cap and expect a 400.
    console.log(`\n=== BUDGET CAP ===`);
    const original = await prisma.appSetting.findUnique({ where: { key: USEROP_MAX_OP_COST_WEI_SETTING } });
    await prisma.appSetting.upsert({
      where: { key: USEROP_MAX_OP_COST_WEI_SETTING },
      create: { key: USEROP_MAX_OP_COST_WEI_SETTING, value: '1' },
      update: { value: '1' },
    });
    const overLimit = await api.json<unknown>('/api/userops/sponsor', {
      ownerAddress: owner.address,
      salt: (Date.now() + 1).toString(),
      call: { to: RECIPIENT, value: '0', data: '0x' },
    });
    console.log(`over-limit sponsor    : HTTP ${overLimit.status} — ${overLimit.error?.message ?? '(no error)'}`);
    const capOk = overLimit.status === 400 && Boolean(overLimit.error?.message);
    console.log(`BUDGET CAP REJECTS    : ${capOk ? 'PASS ✅' : 'FAIL ❌'}`);
    // Restore the original cap.
    if (original) {
      await prisma.appSetting.update({
        where: { key: USEROP_MAX_OP_COST_WEI_SETTING },
        data: { value: original.value as never },
      });
    }
    if (!capOk) throw new Error('budget cap did not reject the over-limit request');

    // Clean up the throwaway API key.
    await prisma.apiKey.deleteMany({ where: { keyHash: key.keyHash } });
    console.log(`\n=== PROOF COMPLETE ✅ ===`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

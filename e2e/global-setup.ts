// Playwright global setup for the full-journey E2E (AGENT.md §8, SPEC §17).
//
// Before the browser runs it makes the chain + backend ready:
//   1. Deploys the ERC-4337 v0.7 stack (EntryPoint + factory + VerifyingPaymaster)
//      and the ChatLog to the live anvil chain, recording their addresses in
//      AppSetting (idempotent upserts) — the same operational scripts an operator
//      would run. Required for the sponsored-tx and chat legs.
//   2. Spawns the BullMQ worker (`pnpm worker`) — the ONLY process that holds the
//      operator faucet/relayer/paymaster keys — and waits for `worker.online`.
//      Its PID is handed to global-teardown via a file so it is always killed.
//
// Everything the browser does (vault keygen, signing) still happens client-side;
// this only stands up the chain + worker + operator legs the journey depends on.
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/web/lib/generated/prisma/client';

loadEnv({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const WORKER_PID_FILE = fileURLToPath(new URL('./.worker.pid', import.meta.url));

// Wipe per-run feature rows so the journey's status assertions (SUCCESS /
// COMPLETED / verified) only ever match the CURRENT run — never a stale row from
// a previous run left in this dedicated test DB. Without this a stale SUCCESS can
// satisfy a wait before the current tx confirms, racing the next leg's nonce.
// Users / networks / app settings / sessions are preserved (seed data).
async function resetFeatureTables(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    // FK-safe order: children before parents.
    await prisma.bombardEvent.deleteMany();
    await prisma.bombardRun.deleteMany();
    await prisma.deployment.deleteMany();
    await prisma.transfer.deleteMany();
    await prisma.chatMessage.deleteMany();
    await prisma.faucetRequest.deleteMany();
    await prisma.smartAccount.deleteMany();
    await prisma.keypair.deleteMany();
    await prisma.auditLog.deleteMany();
  } finally {
    await prisma.$disconnect();
  }
  process.stdout.write('[e2e:setup] feature tables reset\n');
}

function runScript(label: string, script: string): void {
  const res = spawnSync('pnpm', ['tsx', script], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`${label} failed:\n${res.stdout}\n${res.stderr}`);
  }
  // Surface the deployed addresses in the test log.
  process.stdout.write(`[e2e:setup] ${label} ok\n`);
}

async function spawnWorker(): Promise<void> {
  const worker = spawn('pnpm', ['worker'], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group so teardown can SIGTERM the whole tree (pnpm → tsx).
    detached: true,
  });
  if (worker.pid) writeFileSync(WORKER_PID_FILE, String(worker.pid), 'utf8');

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker did not come online within 45s')), 45_000);
    const onData = (buf: Buffer): void => {
      const text = buf.toString();
      process.stdout.write(`[worker] ${text}`);
      if (text.includes('worker.online')) {
        clearTimeout(timer);
        worker.stdout?.off('data', onData);
        resolve();
      }
    };
    worker.stdout?.on('data', onData);
    worker.stderr?.on('data', (b: Buffer) => process.stderr.write(`[worker:err] ${b.toString()}`));
    worker.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`worker exited early (code ${code ?? 'null'})`));
    });
  });
  // Detach our listeners; the process keeps running until teardown kills it.
  worker.unref();
  process.stdout.write('[e2e:setup] worker online\n');
}

export default async function globalSetup(): Promise<void> {
  runScript('deploy-4337', 'apps/web/scripts/deploy-4337.ts');
  runScript('deploy-chatlog', 'apps/web/scripts/deploy-chatlog.ts');
  await resetFeatureTables();
  await spawnWorker();
}

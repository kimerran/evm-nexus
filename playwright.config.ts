import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

// Load the local `.env` so the spawned Next dev server + global-setup (deploy
// scripts, worker) inherit DATABASE_URL / REDIS_URL / operator keys / secrets.
loadEnv({ path: fileURLToPath(new URL('./.env', import.meta.url)), quiet: true });

// E2E drives the FULL journey (login → faucet → deploy → transfer → bombard →
// chat commit+verify → sponsored 4337 tx) in a real browser against anvil, with
// the worker + app running. global-setup deploys the 4337 stack + ChatLog and
// spawns the worker; global-teardown stops it.
//
// The web app runs via `next dev` on purpose: `next start` forces
// NODE_ENV=production, which sets the session cookie `Secure` and the browser
// would drop it over plain http://localhost — breaking login. Dev keeps
// NODE_ENV=development (non-secure cookie) so the journey can authenticate.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: process.env.APP_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  webServer: {
    command: 'pnpm --filter @nexus/web dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { ...process.env } as Record<string, string>,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

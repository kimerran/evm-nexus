import { defineConfig, devices } from '@playwright/test';

// E2E specs live in ./e2e. The full login → faucet → deploy → … journey lands in
// later sprints; Sprint 0 ships a smoke spec so the runner is wired.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.APP_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

import { test, expect } from '@playwright/test';

// Placeholder e2e so the Playwright runner is configured in Sprint 0. The real
// journey (login → faucet → deploy → transfer → bombard → chat → sponsored tx)
// is filled in as those features land.
test('smoke: runner is wired', async () => {
  expect(1 + 1).toBe(2);
});

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Two Vitest projects share one root config:
//
//   • unit        — pure, fast, no external services. Runs every `*.test.ts`
//                   EXCEPT the `*.integration.test.ts` pattern. This is what
//                   `pnpm test` runs and what the default CI job gates on.
//   • integration — `*.integration.test.ts` only. Exercises API handlers/workers
//                   against the REAL test Postgres + Redis + anvil and asserts
//                   BOTH DB state and on-chain effects. Run separately with
//                   `pnpm test:integration` (needs the backing services up).
//
// Both load `./vitest.setup.ts` first so `getEnv()` never throws on import.
// Playwright e2e specs live in ./e2e and are excluded from Vitest entirely.
//
// The `@/…` alias mirrors apps/web/tsconfig.json `paths` so lib modules that
// import `@/lib/*` resolve under Vitest. The regex form only matches `@/…`,
// never `@nexus/*` workspace pkgs.
const webRoot = fileURLToPath(new URL('./apps/web/', import.meta.url));
const setupFiles = [fileURLToPath(new URL('./vitest.setup.ts', import.meta.url))];

const sharedExclude = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.next/**',
  '**/out/**',
  'e2e/**',
  // Foundry submodule sources (OpenZeppelin, account-abstraction) ship their
  // own Hardhat/JS test files — never our Vitest suites.
  'packages/contracts/lib/**',
];

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: `${webRoot}$1` }],
  },
  test: {
    globals: true,
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          globals: true,
          environment: 'node',
          setupFiles,
          include: ['{apps,packages,worker}/**/*.{test,spec}.{ts,tsx}'],
          exclude: [...sharedExclude, '**/*.integration.test.{ts,tsx}'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          globals: true,
          environment: 'node',
          setupFiles,
          include: ['{apps,packages,worker}/**/*.integration.test.{ts,tsx}'],
          exclude: sharedExclude,
          // Integration tests share the real Postgres/Redis — run serially so
          // parallel files don't race on the same rows/keys.
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});

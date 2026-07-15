import { defineConfig } from 'vitest/config';

// Single root config runs every unit/integration test across the workspace.
// Playwright e2e specs live in ./e2e and are excluded here.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['{apps,packages,worker}/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/out/**', 'e2e/**'],
  },
});

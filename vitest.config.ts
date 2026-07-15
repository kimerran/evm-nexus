import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Single root config runs every unit/integration test across the workspace.
// Playwright e2e specs live in ./e2e and are excluded here.
//
// The `@/…` alias mirrors apps/web/tsconfig.json `paths` so lib modules that
// import `@/lib/*` resolve under Vitest (Next resolves it via the tsconfig
// plugin). The regex form only matches `@/…`, never `@nexus/*` workspace pkgs.
const webRoot = fileURLToPath(new URL('./apps/web/', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: `${webRoot}$1` }],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['{apps,packages,worker}/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/out/**', 'e2e/**'],
  },
});

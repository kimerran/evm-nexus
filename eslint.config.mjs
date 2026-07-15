// Root ESLint flat config (ESLint 9). The shared base lives in packages/config
// so every workspace package lints identically. Run with `eslint .` — `next lint`
// was removed in Next 16.
import { baseConfig } from './packages/config/eslint.base.mjs';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/cache/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/generated/**',
      '**/*.d.ts',
    ],
  },
  ...baseConfig,
];

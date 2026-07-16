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
      // Auto-generated contract ABIs + bytecode (from the Foundry build).
      'packages/types/src/contracts/**',
      // Foundry submodule sources (OpenZeppelin, account-abstraction) ship their
      // own JS/TS Hardhat tests — never our code to lint.
      'packages/contracts/lib/**',
      '**/*.d.ts',
    ],
  },
  ...baseConfig,
];

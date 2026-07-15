// Shared ESLint flat config for every workspace package. Typed-linting is left
// off deliberately so `eslint .` stays fast and does not need per-package
// tsconfig project wiring; the `no-any` rule (AGENT.md §4) works without it.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export const baseConfig = tseslint.config({
  files: ['**/*.{ts,tsx,mts,cts}'],
  extends: [js.configs.recommended, ...tseslint.configs.recommended],
  rules: {
    // AGENT.md §4: no `any` — use `unknown` + narrowing.
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/consistent-type-imports': 'error',
  },
});

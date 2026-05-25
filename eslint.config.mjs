import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    settings: {
      react: { version: '19' },
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    '.next-worker/**',
    'out/**',
    'build/**',
    'dist/**',
    'coverage/**',
    '.modules/**',
    'next-env.d.ts',
  ]),
  {
    files: ['apphost.ts'],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.apphost.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { checkThenables: true }],
    },
  },
  // Must come last: turns off all ESLint formatting rules that would
  // otherwise fight Prettier.
  prettier,
]);

export default eslintConfig;

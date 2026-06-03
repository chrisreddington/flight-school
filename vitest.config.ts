import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Mark `node:sqlite` as external so vite never tries to bundle it.
 *
 * Node 22's `module.builtinModules` omits the still-experimental `node:sqlite`,
 * so vite's builtin resolver does not recognise it and tries to bundle it into
 * the jsdom test environment — which fails with "Cannot bundle Node.js built-in
 * node:sqlite". Resolving it as external (with `enforce: 'pre'`, ahead of vite's
 * builtin resolver) keeps every storage test working on the CI-pinned Node 22,
 * present and future, without per-file environment pragmas.
 */
const externalizeNodeSqlite = {
  name: 'externalize-node-sqlite',
  enforce: 'pre' as const,
  resolveId(id: string) {
    if (id === 'node:sqlite') {
      return { id: 'node:sqlite', external: true };
    }
    return null;
  },
};

export default defineConfig({
  plugins: [externalizeNodeSqlite, react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '.next/**', '.modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/test/', '**/*.d.ts', '**/*.config.*', '.next/'],
    },
    // Handle node_modules that include CSS
    server: {
      deps: {
        inline: ['@primer/react'],
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './src/test/mocks/server-only.ts'),
      'client-only': path.resolve(__dirname, './src/test/mocks/client-only.ts'),
    },
  },
});

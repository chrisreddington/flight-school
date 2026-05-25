// Shared esbuild config for the worker bundle.
//
// Imported by both `scripts/build-worker.mjs` (production build) and
// `scripts/check-worker-next-free.mjs` (CI gate) so the gate and the
// shipped bundle use the same external/alias/target rules.
//
// Native + runtime-resolution packages are marked external because
// esbuild would otherwise inline them and break native binding lookup.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

export const WORKER_EXTERNALS = [
  '@github/copilot',
  '@github/copilot-sdk',
  '@github/copilot-*',
  '@azure/*',
  '@opentelemetry/*',
  '@hono/*',
  'hono',
  'sharp',
  '@img/sharp-*',
  'tree-sitter',
  'tree-sitter-*',
];

export function buildWorkerEsbuildOptions(overrides = {}) {
  return {
    entryPoints: [resolve(REPO_ROOT, 'src/worker/bootstrap.ts'), resolve(REPO_ROOT, 'src/worker/server-main.ts')],
    outdir: resolve(REPO_ROOT, 'dist-worker'),
    outExtension: { '.js': '.mjs' },
    entryNames: '[name]',
    chunkNames: 'chunks/[name]-[hash]',
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    sourcemap: true,
    external: WORKER_EXTERNALS,
    // `server-only` is purely a Next.js compiler signal; in plain Node it's
    // a runtime no-op. Alias it to an empty module so worker bundles don't
    // need that package present at runtime.
    alias: {
      'server-only': resolve(SCRIPT_DIR, 'server-only-shim.mjs'),
    },
    conditions: ['node', 'import'],
    ...overrides,
  };
}

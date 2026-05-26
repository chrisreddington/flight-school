#!/usr/bin/env node
/**
 * Dev runner for the standalone Copilot worker.
 *
 * Why this file exists: the worker module graph is ESM-by-design and
 * relies on esbuild's bundle-time alias for the `server-only` marker
 * package (see `scripts/worker-esbuild-config.mjs`). `tsx watch` does
 * not apply that alias, and resolves `.ts` files via CJS because the
 * root `package.json` has no `"type": "module"` field — so worker
 * boot fails on (a) top-level await transpilation, (b) `server-only`
 * throwing at require time, and (c) `@octokit/app` exports having no
 * CJS main. Mirroring the production build pipeline avoids all three.
 *
 * Flow:
 *   1. Start an esbuild watch context using the same options as the
 *      production bundle (`build:worker`).
 *   2. After every successful rebuild, kill the previous worker child
 *      process and spawn a fresh `node dist-worker/bootstrap.mjs`.
 *   3. Forward SIGINT/SIGTERM so Aspire can stop the resource cleanly.
 *
 * NOTE: This is a dev-only script. The CI gate
 * (`scripts/check-worker-next-free.mjs`) and the production builder
 * (`scripts/build-worker.mjs`) still own correctness for shipping
 * bundles — this just shares their options module so dev mirrors prod.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { context } from 'esbuild';

import { buildWorkerEsbuildOptions } from './worker-esbuild-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const ENTRY = resolve(REPO_ROOT, 'dist-worker/bootstrap.mjs');

let child = null;
let restartTimer = null;

function killChild() {
  if (!child) return;
  const dying = child;
  child = null;
  try {
    dying.kill('SIGTERM');
  } catch {
    // already gone
  }
}

function startChild() {
  killChild();
  child = spawn(process.execPath, [ENTRY], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code, signal) => {
    if (child) {
      // Unexpected exit (not triggered by our restart)
      process.stderr.write(`[dev-worker] node exited code=${code} signal=${signal}\n`);
      child = null;
    }
  });
}

function scheduleRestart() {
  // Debounce burst rebuilds (esbuild may fire onEnd multiple times)
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startChild();
  }, 100);
}

const ctx = await context({
  ...buildWorkerEsbuildOptions(),
  logLevel: 'warning',
  plugins: [
    {
      name: 'dev-worker-restart',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length > 0) {
            process.stderr.write(`[dev-worker] rebuild failed (${result.errors.length} errors)\n`);
            return;
          }
          process.stdout.write('[dev-worker] rebuild ok — restarting node\n');
          scheduleRestart();
        });
      },
    },
  ],
});

await ctx.watch();

async function shutdown(signal) {
  process.stdout.write(`[dev-worker] received ${signal} — shutting down\n`);
  killChild();
  try {
    await ctx.dispose();
  } catch {
    // best effort
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

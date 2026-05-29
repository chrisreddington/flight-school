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

// `next dev` loads `.env.local` for the web tier automatically, but Aspire
// launches the worker as a bare executable that only inherits this runner's
// environment. Load `.env.local` here so the worker sees the same secrets —
// notably AUDIT_SALT, which the worker bootstrap requires and which must
// match the web tier's value for cross-process audit-hash determinism.
// `--env-file` semantics apply: vars already set (e.g. Aspire-injected PORT)
// take precedence over the file, so this never clobbers the resource config.
try {
  process.loadEnvFile(resolve(REPO_ROOT, '.env.local'));
} catch {
  // No `.env.local` (e.g. CI) — rely on the inherited environment.
}

let child = null;
let restartTimer = null;

// Restart coalescing: every successful rebuild bumps `restartRequested`.
// `runRestarts` drains requests one at a time, fully stopping the previous
// worker (and waiting for its port to free) before spawning the replacement.
let restartRequested = 0;
let restartApplied = 0;
let draining = false;

// Children we deliberately stop (restart or shutdown). Their `exit` is
// expected, so the crash logger below stays quiet for them.
const intentionalExits = new Set();

// Hard ceiling for a graceful SIGTERM before we escalate to SIGKILL. The
// worker's Hono server must release port 3001 before the replacement binds
// it, otherwise the fresh child dies with EADDRINUSE.
const STOP_GRACE_MS = 2000;

/** Stop a worker child, resolving only once it has actually exited. */
function stopChild(dying) {
  intentionalExits.add(dying);
  return new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      try {
        dying.kill('SIGKILL');
      } catch {
        // already gone
      }
    }, STOP_GRACE_MS);
    dying.once('exit', () => {
      clearTimeout(killTimer);
      resolve();
    });
    try {
      dying.kill('SIGTERM');
    } catch {
      // already gone — resolve via the synthetic exit below
      clearTimeout(killTimer);
      resolve();
    }
  });
}

function startChild() {
  const proc = spawn(process.execPath, [ENTRY], {
    stdio: 'inherit',
    env: process.env,
  });
  child = proc;
  proc.on('exit', (code, signal) => {
    if (intentionalExits.delete(proc)) {
      // Expected exit from a restart or shutdown — nothing to report.
      return;
    }
    // Unexpected crash: surface it and drop the handle so the next
    // rebuild spawns a fresh child instead of trying to stop a corpse.
    process.stderr.write(`[dev-worker] node exited unexpectedly code=${code} signal=${signal}\n`);
    if (child === proc) child = null;
  });
}

/**
 * Drain pending restart requests serially. Each pass stops the current
 * worker (awaiting its real exit) before spawning the next, so the port is
 * always free. Bursts of rebuilds collapse into a single trailing restart.
 */
async function runRestarts() {
  if (draining) return;
  draining = true;
  try {
    while (restartApplied < restartRequested) {
      const target = restartRequested;
      if (child) {
        const dying = child;
        child = null;
        await stopChild(dying);
      }
      startChild();
      restartApplied = target;
    }
  } finally {
    draining = false;
  }
}

function scheduleRestart() {
  // Debounce burst rebuilds (esbuild may fire onEnd multiple times); the
  // counter ensures the trailing timer reflects every rebuild seen so far.
  restartRequested += 1;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void runRestarts();
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
  if (child) {
    const dying = child;
    child = null;
    await stopChild(dying);
  }
  try {
    await ctx.dispose();
  } catch {
    // best effort
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

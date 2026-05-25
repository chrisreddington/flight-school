#!/usr/bin/env node
/**
 * check-worker-next-free
 *
 * CI gate that proves no `next/*` import (and no `server-only` marker)
 * is reachable from the worker entrypoint. The intent: the worker
 * process never accidentally pulls in Next.js framework code, which
 * would (a) bloat the worker image, (b) reintroduce request-bound
 * state that doesn't belong in a long-lived job runner, and (c)
 * defeat the whole point of running the worker outside Next.
 *
 * Behaviour:
 *   - Imports the shared esbuild options module, runs an in-memory
 *     bundle of the worker entry with `metafile: true`, and asserts:
 *       (a) no input file lives under `node_modules/next/`,
 *       (b) no output `imports[*].path` matches `^next($|/)`, and
 *       (c) no input or output references the `server-only` marker
 *           package (a Next-compiler signal that is a runtime no-op
 *           in plain Node).
 *
 * Uses the IDENTICAL bundler config as production (same entryPoints,
 * externals, platform, target, conditions, aliases). Otherwise the
 * gate could pass while production fails.
 */

import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const BOOTSTRAP_ENTRY = resolve(REPO_ROOT, 'src/worker/bootstrap.ts');

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const FORBIDDEN_INPUT_PREFIXES = ['node_modules/next/', 'node_modules/server-only/'];
const FORBIDDEN_IMPORT_PATTERNS = [/^next($|\/)/, /^server-only$/];

async function loadSharedEsbuildOptions() {
  // Resolved lazily so the pre-B.7-3 path doesn't require the module
  // (or esbuild) to exist. The config lands with B.7-6.
  const modulePath = resolve(REPO_ROOT, 'scripts/worker-esbuild-config.mjs');
  if (!(await fileExists(modulePath))) {
    throw new Error(
      `Worker bootstrap exists but scripts/worker-esbuild-config.mjs is missing. ` +
        `The gate needs the shared config to mirror production exactly.`,
    );
  }
  return import(modulePath);
}

async function runMetafileScan() {
  const { buildWorkerEsbuildOptions } = await loadSharedEsbuildOptions();
  const { build } = await import('esbuild');

  const options = buildWorkerEsbuildOptions({ write: false, metafile: true });
  const result = await build(options);
  const metafile = result.metafile;
  if (!metafile) {
    throw new Error('esbuild returned no metafile — the gate cannot run.');
  }

  const leaks = [];

  for (const inputPath of Object.keys(metafile.inputs)) {
    if (FORBIDDEN_INPUT_PREFIXES.some((p) => inputPath.startsWith(p))) {
      leaks.push(`input file under forbidden prefix: ${inputPath}`);
    }
  }

  for (const [outputPath, output] of Object.entries(metafile.outputs)) {
    for (const dep of output.imports ?? []) {
      if (FORBIDDEN_IMPORT_PATTERNS.some((rx) => rx.test(dep.path))) {
        leaks.push(`${outputPath} → import "${dep.path}" matches forbidden pattern`);
      }
    }
  }

  return leaks;
}

async function main() {
  if (!(await fileExists(BOOTSTRAP_ENTRY))) {
    console.error(
      `check-worker-next-free: worker entry not found at ${BOOTSTRAP_ENTRY}.`,
    );
    process.exit(1);
  }

  const leaks = await runMetafileScan();
  if (leaks.length === 0) {
    console.log('check-worker-next-free: worker entry graph is Next-free ✓');
    return;
  }

  console.error('check-worker-next-free: forbidden imports reached from worker entry:');
  for (const leak of leaks) console.error(`  - ${leak}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('check-worker-next-free: failed to run');
  console.error(err);
  process.exit(1);
});

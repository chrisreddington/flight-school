#!/usr/bin/env node
/**
 * check-worker-next-free
 *
 * CI gate that proves no `next/*` import (and no `server-only` marker)
 * is reachable from the worker entrypoint. The intent: the worker
 * process never accidentally pulls in Next.js framework code, which
 * would (a) bloat the worker image, (b) reintroduce request-bound
 * state that doesn't belong in a long-lived job runner, and (c)
 * defeat the whole point of extracting the worker out of Next.
 *
 * Lifecycle:
 *   - **Pre-B.7-3** (this commit): `src/worker/bootstrap.ts` does not
 *     yet exist. The script prints a notice and exits 0. Adding it
 *     here is intentional — it lands in the same commit as the
 *     `src/lib/**` Next-detangling refactor (B.1) so subsequent
 *     commits can rely on the gate being wired into
 *     `check:guardrails`.
 *   - **From B.7-3 onward**: the script imports the shared esbuild
 *     options module, runs an in-memory bundle of the worker entry
 *     with `metafile: true`, and asserts that:
 *       (a) no input file lives under `node_modules/next/`,
 *       (b) no output `imports[*].path` matches `^next($|/)`, and
 *       (c) no input or output references the `server-only` marker
 *           package (which is purely a Next-compiler signal and a
 *           runtime no-op in plain Node — see plan B.1).
 *
 * The IDENTICAL bundler config used in production must be reused
 * here (same entryPoints, externals, platform, target, conditions,
 * aliases). Otherwise the gate can pass while production fails —
 * see plan R6: codex-dev MED-2.
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
    console.log(
      'check-worker-next-free: src/worker/bootstrap.ts not yet present; gate is dormant ' +
        'until the worker extraction lands (plan B.7-3). Exiting 0.',
    );
    return;
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

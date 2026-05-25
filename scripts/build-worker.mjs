#!/usr/bin/env node
/**
 * Production worker bundle.
 *
 * Builds `src/worker/bootstrap.ts` + `src/worker/server-main.ts` to
 * `dist-worker/*.mjs` via esbuild, using the shared options module so
 * the CI gate (`scripts/check-worker-next-free.mjs`) and this build
 * agree byte-for-byte on entry points, externals, and aliases.
 *
 * After bundling, derives a minimal `dist-worker/package.json` listing
 * every externalised runtime package (step 1: direct externals from
 * the esbuild metafile; step 2: transitive optional-dep closure from
 * `package-lock.json`'s `packages` map for platform-variant prebuilds).
 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { buildWorkerEsbuildOptions } from './worker-esbuild-config.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DIST_DIR = resolve(REPO_ROOT, 'dist-worker');

async function main() {
  mkdirSync(DIST_DIR, { recursive: true });

  const result = await build(buildWorkerEsbuildOptions({ write: true, metafile: true }));
  const metafile = result.metafile;
  if (!metafile) throw new Error('esbuild returned no metafile');

  const directExternals = new Set();
  for (const output of Object.values(metafile.outputs)) {
    for (const dep of output.imports ?? []) {
      if (dep.external && !dep.path.startsWith('node:')) {
        directExternals.add(dep.path);
      }
    }
  }

  const lockfile = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package-lock.json'), 'utf8'));
  const lockPackages = lockfile.packages ?? {};

  function resolveSpec(spec) {
    // npm scope-package or plain name; lookup `node_modules/<spec>`
    return lockPackages[`node_modules/${spec}`];
  }

  const closure = new Map();
  function walk(spec) {
    if (closure.has(spec)) return;
    const entry = resolveSpec(spec);
    if (!entry) return;
    closure.set(spec, entry.version);
    const deps = { ...(entry.dependencies ?? {}), ...(entry.optionalDependencies ?? {}) };
    for (const childName of Object.keys(deps)) walk(childName);
  }
  for (const spec of directExternals) walk(spec);

  const dependencies = {};
  for (const [name, version] of closure) dependencies[name] = version;

  const pkg = {
    name: 'flight-school-worker',
    version: '0.0.0',
    private: true,
    type: 'module',
    main: 'bootstrap.mjs',
    dependencies,
  };
  writeFileSync(resolve(DIST_DIR, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  console.log(
    `build-worker: bundled ${Object.keys(metafile.outputs).length} outputs; ` +
      `${closure.size} runtime deps written to dist-worker/package.json`,
  );
}

main().catch((err) => {
  console.error('build-worker failed:', err);
  process.exit(1);
});

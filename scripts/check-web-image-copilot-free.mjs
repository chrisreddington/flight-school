#!/usr/bin/env node
/**
 * check-web-image-copilot-free.mjs
 *
 * Enforces that the web container image contains zero `@github/copilot*`
 * code: not as a copied directory, not on disk in the standalone trace,
 * and not as an externalized runtime `require`/`import` edge in the
 * built JS.
 *
 * Layered defence (this script implements layers 2–4):
 *   1. Source guard       — scripts/check-copilot-sdk-boundary.mjs
 *   2. Dockerfile lint    — Assertion A (here)
 *   3. Standalone disk    — Assertion B (here)
 *   4. Built JS scan      — Assertion C (here)
 *   5. Runtime fail-loud  — next.config.ts `serverExternalPackages`
 *
 * Run via `npm run check:web-image` after `npm run build`.
 *
 * Env vars:
 *   NEXT_DIST_DIR          — match next.config.ts; defaults to `.next`.
 *   SKIP_WEB_IMAGE_CHECK=1 — local-only opt-out when standalone is
 *                            missing. CI must never set this.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DOCKERFILE = path.join(REPO_ROOT, 'Dockerfile');
const DIST_DIR = process.env.NEXT_DIST_DIR ?? '.next';
const STANDALONE = path.join(REPO_ROOT, DIST_DIR, 'standalone');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

const failures = [];
function fail(assertion, message) {
  failures.push(`${assertion}: ${message}`);
}

// ---------- Assertion A: Dockerfile static lint --------------------------
//
// Bans two patterns in the runner stage:
//   r1: COPY ... @github (anywhere in the file)
//   r2: COPY ... /app/node_modules (inside the runner stage only)
//
// Stage detection is header-anchored: enumerate `FROM ...` lines,
// pick the one whose header text contains `AS runner`, and slice
// from that header to the next header (or EOF). Tolerates flags on
// the FROM line (e.g. `FROM --platform=linux/amd64 node:20-slim AS runner`).
async function assertionA() {
  const raw = await fs.readFile(DOCKERFILE, 'utf8');
  // Join `\` line continuations so multi-line COPY instructions match.
  const joined = raw.replace(/\\\n\s*/g, ' ');
  // Strip full-line `#` comments — defence in depth foreclosing any
  // future stylised comment that might look like an instruction.
  const stripped = joined.replace(/^\s*#[^\n]*/gm, '');

  const r1 = /^\s*COPY\b[^\n]*@github/im;
  if (r1.test(stripped)) {
    fail(
      'Assertion A',
      `Dockerfile contains a \`COPY ... @github\` instruction. The web ` +
        `image must not ship the \`@github/*\` namespace. Remove the COPY ` +
        `and verify the standalone trace stays clean.`,
    );
  }

  const fromHeaderRegex = /^FROM\b[^\n]*$/gim;
  const headers = [...stripped.matchAll(fromHeaderRegex)];
  const runnerHeader = headers.find((m) => /\bAS\s+runner\b/i.test(m[0]));
  if (!runnerHeader) {
    fail(
      'Assertion A',
      `Dockerfile has no \`AS runner\` stage; gate cannot scope r2. ` +
        `If you renamed the runner stage, update this script.`,
    );
    return;
  }
  const runnerStart = runnerHeader.index + runnerHeader[0].length;
  const nextHeader = headers.find((m) => m.index > runnerHeader.index);
  const runnerEnd = nextHeader ? nextHeader.index : stripped.length;
  const runnerStage = stripped.slice(runnerStart, runnerEnd);

  const r2 = /^\s*COPY\b[^\n]*\/app\/node_modules\b/im;
  if (r2.test(runnerStage)) {
    fail(
      'Assertion A',
      `Runner-stage \`COPY ... /app/node_modules\` is forbidden by ` +
        `design — the standalone tree at \`/app/.next/standalone\` is ` +
        `self-contained. If you need a runtime package, scope the COPY ` +
        `to the specific path and re-justify the gate.`,
    );
  }
}

// ---------- Assertion B: Standalone disk content -------------------------
//
// Recursively walk <distDir>/standalone/** and fail if any directory
// path contains the segment pair `node_modules` → `@github`. The check
// is segment-bounded (not substring) so legitimate packages such as
// `@github-actions/core` do not false-positive.
async function assertionB() {
  let standaloneExists = true;
  try {
    await fs.stat(STANDALONE);
  } catch {
    standaloneExists = false;
  }
  if (!standaloneExists) {
    if (process.env.SKIP_WEB_IMAGE_CHECK === '1') {
      console.warn(
        `${YELLOW}⚠  Assertion B skipped: ${path.relative(REPO_ROOT, STANDALONE)} ` +
          `not found (SKIP_WEB_IMAGE_CHECK=1).${RESET}`,
      );
      return;
    }
    fail(
      'Assertion B',
      `Standalone build output not found at \`${path.relative(REPO_ROOT, STANDALONE)}\`. ` +
        `Run \`npm run build\` first. Local opt-out: SKIP_WEB_IMAGE_CHECK=1.`,
    );
    return;
  }

  const hits = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(STANDALONE, full);
      const segments = rel.split(path.sep);
      const hit = segments.some(
        (seg, i) =>
          i > 0 && segments[i - 1] === 'node_modules' && seg === '@github',
      );
      if (hit) hits.push(rel);
      await walk(full);
    }
  }
  await walk(STANDALONE);

  if (hits.length > 0) {
    fail(
      'Assertion B',
      `\`@github/*\` namespace found on disk in standalone tree:\n  - ` +
        hits.join('\n  - ') +
        `\nThe web image must not ship the \`@github/*\` namespace. ` +
        `Investigate which traced package pulled it in.`,
    );
  }
}

// ---------- Assertion C: Built JS scan for runtime require/import edges ---
//
// Walk every `.js`/`.mjs`/`.cjs` under <distDir>/standalone/** and fail
// if any file contains a runtime edge into `@github/copilot*`.
//
// Pattern matches structural require/require.resolve/dynamic-import/from
// tokens followed by a `@github/copilot` string literal. It deliberately
// does NOT match the JSON config blob in `server.js` that lists
// `"@github/copilot-sdk"` inside `"serverExternalPackages":[...]`,
// because no `require`/`import`/`from` token precedes it.
async function assertionC() {
  let standaloneExists = true;
  try {
    await fs.stat(STANDALONE);
  } catch {
    standaloneExists = false;
  }
  if (!standaloneExists) {
    // Assertion B already flagged the missing standalone (or honoured the
    // skip env var). Don't double-fail.
    return;
  }

  const edgeRegex =
    /(?:require(?:\.resolve)?\s*\(\s*|import\s*\(\s*|from\s+)['"]@github\/copilot/;
  const exts = new Set(['.js', '.mjs', '.cjs']);
  const hits = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!exts.has(path.extname(entry.name))) continue;
      const content = await fs.readFile(full, 'utf8');
      if (edgeRegex.test(content)) {
        hits.push(path.relative(STANDALONE, full));
      }
    }
  }
  await walk(STANDALONE);

  if (hits.length > 0) {
    fail(
      'Assertion C',
      `Runtime require/import edge into \`@github/copilot*\` found in ` +
        `built JS:\n  - ` +
        hits.join('\n  - ') +
        `\nWith \`serverExternalPackages\` retained, such an edge would ` +
        `crash at startup with "Cannot find module". Remove the import ` +
        `or move the calling code into the worker.`,
    );
  }
}

// ---------- Main ----------------------------------------------------------
(async () => {
  await assertionA();
  await assertionB();
  await assertionC();

  if (failures.length > 0) {
    console.error(`${RED}✗ Web image SDK-free check FAILED${RESET}\n`);
    for (const f of failures) {
      console.error(`${RED}  ${f}${RESET}\n`);
    }
    process.exit(1);
  }
  console.log(`${GREEN}✓ Web image is Copilot SDK-free${RESET}`);
})().catch((err) => {
  console.error(`${RED}✗ check-web-image-copilot-free crashed:${RESET}`, err);
  process.exit(1);
});

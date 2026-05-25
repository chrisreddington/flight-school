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
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
// Two checks on the runner stage:
//   r1: bans `COPY ... @github` anywhere in the file.
//   r2: positive allowlist — every runner-stage COPY source MUST match
//       `isAllowedRunnerSource()`. Any source not on the allowlist
//       fails the gate. This subsumes all known broad-copy bypass
//       shapes (`/app`, `/app/`, `/app/.`, `/app/*`, `/app/node_modules`,
//       JSON-array `["/app", "./"]`), all relative-source shapes
//       (`.`, `./`, `*`), and all unresolved variable-source shapes
//       (`${VAR}`) — none of those match the allowlist.
//
// Stage detection is header-anchored: enumerate `FROM ...` lines,
// pick the one whose header text contains `AS runner`, and slice
// from that header to the next header (or EOF). Tolerates flags on
// the FROM line (e.g. `FROM --platform=linux/amd64 node:20-slim AS runner`).

// Exact matches and segment-bounded prefixes. The `/` boundary on
// prefixes is required so `/app/publicity` does not silently match
// `/app/public`.
const RUNNER_ALLOWED_RUNNER_SOURCES = ['/app/public'];
const RUNNER_ALLOWED_RUNNER_PREFIXES = ['/app/.next/', '/app/public/'];

function isAllowedRunnerSource(src) {
  if (RUNNER_ALLOWED_RUNNER_SOURCES.includes(src)) return true;
  return RUNNER_ALLOWED_RUNNER_PREFIXES.some((p) => src.startsWith(p));
}

function describeAllowlist() {
  return [...RUNNER_ALLOWED_RUNNER_SOURCES, ...RUNNER_ALLOWED_RUNNER_PREFIXES].join(', ');
}

/**
 * Extract the list of source paths from a single Dockerfile COPY
 * instruction (line-continuations already joined). Handles both
 * shell-form (`COPY [--flag=v]... src... dst`) and JSON-array form
 * (`COPY [--flag=v]... ["src",...,"dst"]`). Returns sources only
 * (the final element — the destination — is dropped).
 */
function extractCopySources(copyLine) {
  // Drop the leading `COPY` keyword and any `--flag=value` options.
  // Flag values never contain whitespace at the Dockerfile syntax
  // level so a single-token strip is safe.
  const withoutKeyword = copyLine.replace(/^\s*COPY\b/i, '').trim();
  const withoutFlags = withoutKeyword.replace(/(^|\s)--\S+/g, '').trim();

  // JSON-array form: `["src", ..., "dst"]`.
  if (withoutFlags.startsWith('[')) {
    const arrayMatch = withoutFlags.match(/^\[([^\]]*)\]/);
    if (!arrayMatch) return [];
    const elements = arrayMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
    return elements.slice(0, -1);
  }

  // Shell form: whitespace-separated tokens, last is destination.
  const tokens = withoutFlags.split(/\s+/).filter(Boolean);
  return tokens.slice(0, -1);
}

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
      `Dockerfile has no \`AS runner\` stage; gate cannot scope r2/r3. ` +
        `If you renamed the runner stage, update this script.`,
    );
    return;
  }
  const runnerStart = runnerHeader.index + runnerHeader[0].length;
  const nextHeader = headers.find((m) => m.index > runnerHeader.index);
  const runnerEnd = nextHeader ? nextHeader.index : stripped.length;
  const runnerStage = stripped.slice(runnerStart, runnerEnd);

  // r2: positive allowlist. Parse every runner-stage COPY and require
  // every source to match `isAllowedRunnerSource`. This catches every
  // broad-copy shape (`/app`, `/app/`, `/app/.`, `/app/*`, JSON-array
  // form), every relative source (`.`, `./`, `*`), every unresolved
  // variable source (`${...}`), and segment-bounded near-misses like
  // `/app/publicity` that a non-bounded prefix would silently allow.
  const copyLineRegex = /^\s*COPY\b[^\n]*/gim;
  const copyLines = [...runnerStage.matchAll(copyLineRegex)].map((m) => m[0]);
  for (const copyLine of copyLines) {
    const sources = extractCopySources(copyLine);
    for (const src of sources) {
      if (isAllowedRunnerSource(src)) continue;
      fail(
        'Assertion A',
        `Runner-stage COPY source \`${src}\` is not on the allowlist ` +
          `(${describeAllowlist()}). Broad sources (\`/app\`, \`.\`, ` +
          `\`./\`, \`\${VAR}\`) would transitively copy \`node_modules\` ` +
          `from the source stage into the final image. Scope to a ` +
          `specific descendant or extend the allowlist with justification.\n` +
          `  in: ${copyLine.trim()}`,
      );
    }
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
      if (hit) {
        hits.push(rel);
        // Don't recurse into a known hit — one path is enough to
        // signal the violation and keeps the failure output crisp.
        continue;
      }
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

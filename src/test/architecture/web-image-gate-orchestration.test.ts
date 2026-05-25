import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const exec = promisify(execFile);

// The repo-relative path to the gate script. Resolved relative to
// cwd (the test runner sets cwd to the repo root) so the same
// import works whether tests run from CLI or from CI.
const GATE_SCRIPT = path.resolve('scripts/check-web-image-copilot-free.mjs');

// Orchestration tests for Assertion A — the Dockerfile static lint.
// The 25 parser-helper tests (`web-image-gate-parser.test.ts`) cover
// the structural parser in isolation; this file exercises the full
// pipeline end-to-end: read the Dockerfile, join line continuations,
// strip comments, locate the runner stage by header, slice the
// stage's text, and run the allowlist against every COPY in it.
// A regression in any of those steps would silently disable Assertion
// A; integration coverage protects against that.

async function runGate(repoRoot: string) {
  // SKIP_WEB_IMAGE_CHECK=1 lets Assertion A run without requiring
  // the `.next/standalone` directory to exist on disk.
  // WEB_IMAGE_GATE_DOCKERFILE points the gate at the fixture
  // Dockerfile; otherwise the script reads its own repo's Dockerfile
  // (computed from `import.meta.url`), not the tmp fixture.
  return exec('node', [GATE_SCRIPT], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SKIP_WEB_IMAGE_CHECK: '1',
      NEXT_DIST_DIR: '.next-nonexistent',
      WEB_IMAGE_GATE_DOCKERFILE: path.join(repoRoot, 'Dockerfile'),
    },
  });
}

describe('check-web-image-copilot-free.mjs — Assertion A orchestration', () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'gate-test-'));
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('passes when the runner stage only copies allowlisted sources', async () => {
    await writeFile(
      path.join(repoRoot, 'Dockerfile'),
      [
        'FROM node:20-slim AS builder',
        'COPY . /build',
        'RUN npm run build',
        '',
        'FROM node:20-slim AS runner',
        'COPY --from=builder /app/.next/standalone /app/.next/standalone',
        'COPY --from=builder /app/.next/static /app/.next/static',
        'COPY --from=builder /app/public /app/public',
        'CMD ["node", "server.js"]',
      ].join('\n'),
    );
    const { stdout } = await runGate(repoRoot);
    expect(stdout).toContain('Web image is Copilot SDK-free');
  });

  it('fails when the runner stage copies the entire @github namespace', async () => {
    await writeFile(
      path.join(repoRoot, 'Dockerfile'),
      [
        'FROM node:20-slim AS runner',
        'COPY --from=builder /app/node_modules/@github /app/node_modules/@github',
        'CMD ["node", "server.js"]',
      ].join('\n'),
    );
    await expect(runGate(repoRoot)).rejects.toMatchObject({ code: 1 });
  });

  it('fails when the runner stage copies a broad source not on the allowlist', async () => {
    await writeFile(
      path.join(repoRoot, 'Dockerfile'),
      ['FROM node:20-slim AS runner', 'COPY --from=builder /app /app', 'CMD ["node", "server.js"]'].join('\n'),
    );
    await expect(runGate(repoRoot)).rejects.toMatchObject({ code: 1 });
  });

  it('joins line-continuations so a split COPY is parsed as one instruction', async () => {
    // A multi-line `COPY \` of a broad source must still be detected
    // — otherwise the `\\\n` join step's regression would silently
    // hide instructions from the allowlist.
    await writeFile(
      path.join(repoRoot, 'Dockerfile'),
      [
        'FROM node:20-slim AS runner',
        'COPY \\',
        '  --from=builder \\',
        '  /app/node_modules \\',
        '  /app/node_modules',
        'CMD ["node", "server.js"]',
      ].join('\n'),
    );
    await expect(runGate(repoRoot)).rejects.toMatchObject({ code: 1 });
  });

  it('strips full-line comments so a commented-out broad COPY does not trigger', async () => {
    await writeFile(
      path.join(repoRoot, 'Dockerfile'),
      [
        'FROM node:20-slim AS runner',
        '# COPY --from=builder /app /app   ← commented out',
        'COPY --from=builder /app/public /app/public',
        'CMD ["node", "server.js"]',
      ].join('\n'),
    );
    const { stdout } = await runGate(repoRoot);
    expect(stdout).toContain('Web image is Copilot SDK-free');
  });

  it('fails fast when no `AS runner` stage is present', async () => {
    // A renamed runner stage would otherwise silently disable r2/r3.
    await writeFile(
      path.join(repoRoot, 'Dockerfile'),
      ['FROM node:20-slim AS final', 'COPY --from=builder /app /app', 'CMD ["node", "server.js"]'].join('\n'),
    );
    await expect(runGate(repoRoot)).rejects.toMatchObject({ code: 1 });
  });

  it('scopes the allowlist to the runner stage only (broad COPY in builder is fine)', async () => {
    await writeFile(
      path.join(repoRoot, 'Dockerfile'),
      [
        'FROM node:20-slim AS builder',
        'COPY . /build',
        'COPY /app /app',
        '',
        'FROM node:20-slim AS runner',
        'COPY --from=builder /app/.next/standalone /app/.next/standalone',
        'COPY --from=builder /app/.next/static /app/.next/static',
        'COPY --from=builder /app/public /app/public',
        'CMD ["node", "server.js"]',
      ].join('\n'),
    );
    const { stdout } = await runGate(repoRoot);
    expect(stdout).toContain('Web image is Copilot SDK-free');
  });
});

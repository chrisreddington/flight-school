import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const apphostSource = readFileSync(path.join(process.cwd(), 'apphost.ts'), 'utf8');
const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};
const nextConfigSource = readFileSync(path.join(process.cwd(), 'next.config.ts'), 'utf8');

describe('AppHost npm scripts', () => {
  it('does not start the web resource with npm run dev because dev launches Aspire', () => {
    expect(apphostSource).not.toContain("addNextJsApp('flight-school', '.', { runScriptName: 'dev' })");
    expect(apphostSource).toContain("addNextJsApp('flight-school', '.', { runScriptName: 'dev:web-only' })");
  });

  it('clears stale web build artifacts before starting the web dev server', () => {
    expect(packageJson.scripts?.['dev:web-only']).toContain('rm -rf .next');
    expect(packageJson.scripts?.['dev:web-only']).toContain('next dev');
  });

  it('runs the worker as a standalone Node process (no Next)', () => {
    // The worker must not be a Next.js app and must boot via `node`.
    // Whether that's `tsx`, `node` directly, or a dev runner script is
    // an implementation detail; what matters is the standalone-Node
    // contract.
    expect(packageJson.scripts?.['dev:worker']).toBeDefined();
    expect(packageJson.scripts?.['dev:worker']).not.toContain('next dev');
    expect(packageJson.scripts?.['dev:worker']).not.toContain('next start');
    // Must be runnable as a Node entrypoint — either tsx (interpreter
    // for .ts) or a node-based runner script.
    expect(packageJson.scripts?.['dev:worker']).toMatch(/\b(tsx|node)\b/);
  });

  it('wires the worker into Aspire as an executable (not a Next.js app)', () => {
    // Worker must be wired via addExecutable. Tolerate quote-style and
    // whitespace drift, but lock the resource name, command, working dir,
    // and full args vector so a "fix" that re-wraps the worker in
    // addNextJsApp or points it at a different script gets caught.
    expect(apphostSource).toMatch(
      /\.addExecutable\(\s*['"]copilot-worker['"]\s*,\s*['"]npm['"]\s*,\s*['"]\.['"]\s*,\s*\[\s*['"]run['"]\s*,\s*['"]dev:worker['"]\s*\]/,
    );
    expect(apphostSource).not.toMatch(/\.addNextJsApp\(\s*['"]copilot-worker['"]/);
  });

  it('does not set obsolete worker env vars on the worker resource', () => {
    // The AppHost spawns the worker unconditionally; no env var gates
    // this behaviour. `COPILOT_WORKER_MODE` and `COPILOT_WORKER_ENABLED`
    // have no consumer in src/ and must stay off the worker resource so
    // a future edit cannot reintroduce mode-switching by accident.
    expect(apphostSource).not.toContain('COPILOT_WORKER_MODE');
    expect(apphostSource).not.toContain('COPILOT_WORKER_ENABLED');
    // NEXT_OTEL_FETCH_DISABLED must appear EXACTLY once — on the web
    // (Next.js) resource. Zero means we lost the dedupe guard (regression);
    // two means it leaked onto the worker (no Next.js machinery there).
    const occurrences = apphostSource.match(/NEXT_OTEL_FETCH_DISABLED/g) ?? [];
    expect(occurrences.length).toBe(1);
    // Belt-and-braces: explicitly verify the single occurrence is between
    // the flight-school (web) resource declaration and the end of the
    // file, not in the worker block above it. If a future edit moves the
    // var from web to worker, both assertions would otherwise pass.
    // Quote-tolerant regexes match either ' or " so a formatter flip
    // doesn't masquerade as a structural regression.
    const workerStart = apphostSource.search(/addExecutable\(['"]copilot-worker['"]/);
    const webStart = apphostSource.search(/addNextJsApp\(['"]flight-school['"]/);
    const otelIdx = apphostSource.indexOf('NEXT_OTEL_FETCH_DISABLED');
    expect(workerStart).toBeGreaterThanOrEqual(0);
    expect(webStart).toBeGreaterThan(workerStart);
    expect(otelIdx).toBeGreaterThan(webStart);
  });

  it('pins the Turbopack root to this repository for parallel web and worker dev servers', () => {
    expect(nextConfigSource).toContain('turbopack:');
    expect(nextConfigSource).toContain('root: process.cwd()');
  });
});

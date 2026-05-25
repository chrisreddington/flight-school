import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const apphostSource = readFileSync(path.join(process.cwd(), 'apphost.ts'), 'utf8');
const packageJson = JSON.parse(
  readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
) as { scripts?: Record<string, string> };
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
    expect(packageJson.scripts?.['dev:worker']).toContain('tsx');
    expect(packageJson.scripts?.['dev:worker']).toContain('src/worker/bootstrap.ts');
    expect(packageJson.scripts?.['dev:worker']).not.toContain('next dev');
  });

  it('wires the worker into Aspire as an executable (not a Next.js app)', () => {
    // Worker must be wired via addExecutable. Tolerate quote-style and
    // whitespace drift, but lock the resource name, command, working dir,
    // and full args vector so a "fix" that re-wraps the worker in
    // addNextJsApp or points it at a different script gets caught.
    expect(apphostSource).toMatch(
      /\.addExecutable\(\s*['"]copilot-worker['"]\s*,\s*['"]npm['"]\s*,\s*['"]\.['"]\s*,\s*\[\s*['"]run['"]\s*,\s*['"]dev:worker['"]\s*\]/,
    );
    expect(apphostSource).not.toMatch(
      /\.addNextJsApp\(\s*['"]copilot-worker['"]/,
    );
  });

  it('does not set obsolete worker env vars on the worker resource', () => {
    // COPILOT_WORKER_MODE branching was removed when the worker became a
    // standalone Hono process; COPILOT_WORKER_ENABLED has no consumer in
    // src/. Both must stay off the worker resource.
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
    const workerStart = apphostSource.indexOf("addExecutable('copilot-worker'");
    const webStart = apphostSource.indexOf("addNextJsApp('flight-school'");
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

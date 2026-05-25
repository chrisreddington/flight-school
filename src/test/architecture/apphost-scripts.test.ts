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
    // whitespace drift, but lock the resource name, command, and run
    // script so a "fix" that re-wraps the worker in addNextJsApp or
    // points it at a different script gets caught.
    expect(apphostSource).toMatch(
      /\.addExecutable\(\s*['"]copilot-worker['"]\s*,\s*['"]npm['"]/,
    );
    expect(apphostSource).toMatch(/['"]dev:worker['"]/);
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
    // NEXT_OTEL_FETCH_DISABLED is still set on the web resource (still
    // Next.js); make sure that's the only place it appears.
    const occurrences = apphostSource.match(/NEXT_OTEL_FETCH_DISABLED/g) ?? [];
    expect(occurrences.length).toBeLessThanOrEqual(1);
  });

  it('pins the Turbopack root to this repository for parallel web and worker dev servers', () => {
    expect(nextConfigSource).toContain('turbopack:');
    expect(nextConfigSource).toContain('root: process.cwd()');
  });
});

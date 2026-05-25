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
    expect(apphostSource).toContain("addExecutable('copilot-worker'");
    expect(apphostSource).not.toContain("addNextJsApp('copilot-worker'");
  });

  it('pins the Turbopack root to this repository for parallel web and worker dev servers', () => {
    expect(nextConfigSource).toContain('turbopack:');
    expect(nextConfigSource).toContain('root: process.cwd()');
  });
});

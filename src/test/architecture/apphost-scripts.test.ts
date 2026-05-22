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

  it('uses a separate Next dev directory for the worker resource', () => {
    expect(packageJson.scripts?.['dev:worker']).toContain('NEXT_DIST_DIR=.next-worker');
    expect(packageJson.scripts?.['dev:worker']).toContain('rm -rf .next-worker');
    expect(nextConfigSource).toContain("distDir: process.env.NEXT_DIST_DIR ?? '.next'");
  });
});

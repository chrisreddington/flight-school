import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const APP_ROOT = path.join(process.cwd(), 'src/app');
const INTERNAL_API_ROOT = path.join(APP_ROOT, 'api/internal');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    if (!/\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [fullPath];
  });
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

describe('worker job architecture boundaries', () => {
  it('keeps worker implementation imports out of web app files', () => {
    const offenders = sourceFiles(APP_ROOT)
      .filter((filePath) => !filePath.startsWith(INTERNAL_API_ROOT))
      .flatMap((filePath) => {
        const rel = path.relative(process.cwd(), filePath).replaceAll(path.sep, '/');
        const source = readFileSync(filePath, 'utf8');
        return importSpecifiers(source)
          .filter((specifier) => specifier.startsWith('@/worker/'))
          .map((specifier) => `${rel} imports ${specifier}`);
      });

    expect(offenders).toEqual([]);
  });

  it('keeps streaming bus imports inside the worker process boundary', () => {
    const SRC_ROOT = path.join(process.cwd(), 'src');
    const WORKER_ROOT = path.join(SRC_ROOT, 'worker');
    const INTERNAL_ROOT = path.join(SRC_ROOT, 'app/api/internal');
    const offenders = sourceFiles(SRC_ROOT).flatMap((filePath) => {
      // Allowed: anywhere inside src/worker/ or src/app/api/internal/.
      if (filePath.startsWith(WORKER_ROOT)) return [];
      if (filePath.startsWith(INTERNAL_ROOT)) return [];
      const rel = path.relative(process.cwd(), filePath).replaceAll(path.sep, '/');
      const source = readFileSync(filePath, 'utf8');
      return importSpecifiers(source)
        .filter((specifier) => specifier.startsWith('@/worker/jobs/streaming'))
        .map((specifier) => `${rel} imports ${specifier}`);
    });
    expect(offenders).toEqual([]);
  });

  it('keeps web job routes free of in-process executor imports', () => {
    const jobsRoot = path.join(APP_ROOT, 'api/jobs');
    const offenders = sourceFiles(jobsRoot).flatMap((filePath) => {
      const rel = path.relative(process.cwd(), filePath).replaceAll(path.sep, '/');
      const source = readFileSync(filePath, 'utf8');
      return importSpecifiers(source)
        .filter((specifier) => specifier === './job-executors' || specifier.startsWith('./executors/'))
        .map((specifier) => `${rel} imports ${specifier}`);
    });

    expect(offenders).toEqual([]);
  });

  it('keeps jobStorage out of all web API routes (worker owns the index)', () => {
    const apiRoot = path.join(APP_ROOT, 'api');
    const internalRoot = path.join(apiRoot, 'internal');
    // Storage-layer modules that expose the job index. Any import of
    // these from a non-internal web route is an architecture violation.
    const FORBIDDEN_SPECIFIERS = new Set(['@/lib/jobs', '@/lib/jobs/storage']);
    const offenders = sourceFiles(apiRoot)
      .filter((filePath) => !filePath.endsWith('.test.ts'))
      // The internal routes are the worker-side handlers — they're
      // allowed to touch jobStorage. Everything else under `src/app/api/`
      // is the multi-tenant web surface and must go through worker-client.
      .filter((filePath) => !filePath.startsWith(internalRoot))
      .flatMap((filePath) => {
        const rel = path.relative(process.cwd(), filePath).replaceAll(path.sep, '/');
        const source = readFileSync(filePath, 'utf8');
        // Match real top-level imports of the storage-layer modules but
        // not type-only imports of helper types like `BackgroundJob` or
        // `ChatResponseInput`.
        const hits: string[] = [];
        for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
          const spec = match[1];
          if (!FORBIDDEN_SPECIFIERS.has(spec)) continue;
          const importLine = source.slice(0, match.index).match(/import[^;]*$/)?.[0] ?? '';
          if (/\bjobStorage\b/.test(importLine)) {
            hits.push(`${rel} imports jobStorage from ${spec}`);
          }
        }
        return hits;
      });
    expect(offenders).toEqual([]);
  });

  it('routes worker job calls through the worker-client module', () => {
    const jobsRoot = path.join(APP_ROOT, 'api/jobs');
    const workerClient = path.join(jobsRoot, 'worker-client.ts');
    const source = readFileSync(workerClient, 'utf8');

    expect(source).toContain('createWorkerJob');
    expect(source).toContain('cancelWorkerJobRecord');
  });
});

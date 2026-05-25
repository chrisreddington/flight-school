import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const APP_ROOT = path.join(process.cwd(), 'src/app');

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
    const offenders = sourceFiles(SRC_ROOT).flatMap((filePath) => {
      if (filePath.startsWith(WORKER_ROOT)) return [];
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
    const FORBIDDEN_SPECIFIERS = new Set(['@/lib/jobs', '@/lib/jobs/storage']);
    const offenders = sourceFiles(apiRoot)
      .filter((filePath) => !filePath.endsWith('.test.ts'))
      .flatMap((filePath) => {
        const rel = path.relative(process.cwd(), filePath).replaceAll(path.sep, '/');
        const source = readFileSync(filePath, 'utf8');
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

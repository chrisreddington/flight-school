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

  it('uses worker dispatch from the web dispatcher module', () => {
    const dispatcherPath = path.join(APP_ROOT, 'api/jobs/dispatcher.ts');
    const source = readFileSync(dispatcherPath, 'utf8');

    expect(source).toContain('dispatchJobExecutionToWorker');
  });
});

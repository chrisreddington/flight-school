import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const API_ROUTE_ROOT = path.join(process.cwd(), 'src/app/api');

type Boundary =
  | 'public'
  | 'requireUserContext'
  | 'withGuardedRoute'
  | 'createStorageRoute'
  | 'getOctokitForRequest'
  | 'verifyCronRequest';

const ROUTE_BOUNDARIES: Record<string, Boundary> = {
  'ai-activity/metrics/route.ts': 'requireUserContext',
  'ai-activity/route.ts': 'requireUserContext',
  'ai-activity/stream/route.ts': 'requireUserContext',
  'auth/[...nextauth]/route.ts': 'public',
  'challenge/author/route.ts': 'withGuardedRoute',
  'challenge/hint/route.ts': 'withGuardedRoute',
  'challenge/solve/route.ts': 'requireUserContext',
  'challenges/queue/route.ts': 'createStorageRoute',
  'copilot/route.ts': 'withGuardedRoute',
  'cron/sweep/route.ts': 'verifyCronRequest',
  'evaluations/[id]/route.ts': 'requireUserContext',
  'focus/route.ts': 'withGuardedRoute',
  'focus/storage/route.ts': 'createStorageRoute',
  'guided-plan/route.ts': 'withGuardedRoute',
  'habits/storage/route.ts': 'createStorageRoute',
  'health/route.ts': 'public',
  'issues/route.ts': 'withGuardedRoute',
  'jobs/[id]/route.ts': 'requireUserContext',
  'jobs/[id]/stream/route.ts': 'requireUserContext',
  // `jobs/route.ts` is a mixed boundary: POST is wrapped in
  // `withGuardedRoute` (rate-limit + concurrent-cap + audit) because it
  // initiates AI work; GET uses `requireUserContext` only (a redacted
  // list is a cheap read). The inventory marker uses the strongest
  // boundary present in the file.
  'jobs/route.ts': 'withGuardedRoute',
  'otel/v1/traces/route.ts': 'requireUserContext',
  'profile/route.ts': 'getOctokitForRequest',
  'profile/storage/route.ts': 'createStorageRoute',
  'quiz/route.ts': 'withGuardedRoute',
  'repos/create-from-workspace/route.ts': 'getOctokitForRequest',
  'repos/create/route.ts': 'requireUserContext',
  'skills/storage/route.ts': 'createStorageRoute',
  'suggestions/route.ts': 'withGuardedRoute',
  'threads/storage/route.ts': 'createStorageRoute',
  'user/data/route.ts': 'requireUserContext',
  'workspace/storage/list/route.ts': 'requireUserContext',
  'workspace/storage/route.ts': 'requireUserContext',
};

const SOURCE_MARKERS: Record<Boundary, string | null> = {
  public: null,
  requireUserContext: 'requireUserContext(',
  withGuardedRoute: 'withGuardedRoute(',
  createStorageRoute: 'createStorageRoute(',
  getOctokitForRequest: 'getOctokitForRequest(',
  verifyCronRequest: 'verifyCronRequest(',
};

function routeFiles(dir = API_ROUTE_ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(fullPath);
    return entry.name === 'route.ts' ? [fullPath] : [];
  });
}

function routeKey(filePath: string): string {
  return path.relative(API_ROUTE_ROOT, filePath).replaceAll(path.sep, '/');
}

describe('API route auth inventory', () => {
  it('classifies every API route auth boundary', () => {
    const actualRoutes = routeFiles().map(routeKey).sort();
    const expectedRoutes = Object.keys(ROUTE_BOUNDARIES).sort();

    expect(actualRoutes).toEqual(expectedRoutes);
  });

  it('keeps each classified route wired to its declared boundary', () => {
    const missingMarkers = routeFiles()
      .map((filePath) => {
        const key = routeKey(filePath);
        const marker = SOURCE_MARKERS[ROUTE_BOUNDARIES[key]];
        if (!marker) return null;

        const source = readFileSync(filePath, 'utf8');
        if (source.includes(marker)) return null;

        // The route may delegate to a handler module from `@/lib/...`
        // (named `handle*Request`). When it does, follow that import
        // and check the marker there. Keeps thin route shims valid.
        const handlerMatch = source.match(/from\s+['"](@\/lib\/[^'"]+)['"]/g);
        if (handlerMatch) {
          for (const fromClause of handlerMatch) {
            const importPath = fromClause.match(/@\/lib\/[^'"]+/)?.[0];
            if (!importPath) continue;
            const handlerPath = path.join(
              process.cwd(),
              'src',
              importPath.replace('@/', ''),
            ) + '.ts';
            try {
              const handlerSource = readFileSync(handlerPath, 'utf8');
              if (handlerSource.includes(marker)) return null;
            } catch {
              // Handler module not found at that path; keep looking.
            }
          }
        }

        return `${key} missing ${marker}`;
      })
      .filter(Boolean);

    expect(missingMarkers).toEqual([]);
  });
});

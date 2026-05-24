import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const API_ROUTE_ROOT = path.join(process.cwd(), 'src/app/api');

type Boundary =
  | 'public'
  | 'requireUserContext'
  | 'withUserGuards'
  | 'createStorageRoute'
  | 'getOctokitForRequest'
  | 'verifyCronRequest'
  | 'internalWorkerSecret';

const ROUTE_BOUNDARIES: Record<string, Boundary> = {
  'internal/copilot/execute/route.ts': 'internalWorkerSecret',
  'internal/ai-activity/route.ts': 'internalWorkerSecret',
  'internal/ai-activity/event/route.ts': 'internalWorkerSecret',
  'internal/ai-activity/event/[id]/route.ts': 'internalWorkerSecret',
  'internal/ai-activity/stream/route.ts': 'internalWorkerSecret',
  'internal/jobs/route.ts': 'internalWorkerSecret',
  'internal/jobs/sweep/route.ts': 'internalWorkerSecret',
  'internal/jobs/user-data/route.ts': 'internalWorkerSecret',
  'internal/jobs/[id]/route.ts': 'internalWorkerSecret',
  'internal/jobs/[id]/stream/route.ts': 'internalWorkerSecret',
  'ai-activity/metrics/route.ts': 'requireUserContext',
  'ai-activity/route.ts': 'requireUserContext',
  'ai-activity/stream/route.ts': 'requireUserContext',
  'auth/[...nextauth]/route.ts': 'public',
  'challenge/author/route.ts': 'withUserGuards',
  'challenge/evaluate/route.ts': 'withUserGuards',
  'challenge/hint/route.ts': 'withUserGuards',
  'challenge/solve/route.ts': 'requireUserContext',
  'challenges/queue/route.ts': 'createStorageRoute',
  'copilot/route.ts': 'withUserGuards',
  'cron/sweep/route.ts': 'verifyCronRequest',
  'evaluations/[id]/route.ts': 'requireUserContext',
  'focus/route.ts': 'withUserGuards',
  'focus/storage/route.ts': 'createStorageRoute',
  'guided-plan/route.ts': 'withUserGuards',
  'habits/storage/route.ts': 'createStorageRoute',
  'health/route.ts': 'public',
  'issues/route.ts': 'getOctokitForRequest',
  'jobs/[id]/route.ts': 'requireUserContext',
  'jobs/[id]/stream/route.ts': 'requireUserContext',
  // `jobs/route.ts` is a mixed boundary: POST is wrapped in
  // `withUserGuards` (rate-limit + concurrent-cap + audit) because it
  // initiates AI work; GET uses `requireUserContext` only (a redacted
  // list is a cheap read). The inventory marker uses the strongest
  // boundary present in the file.
  'jobs/route.ts': 'withUserGuards',
  'otel/v1/traces/route.ts': 'requireUserContext',
  'profile/route.ts': 'getOctokitForRequest',
  'profile/storage/route.ts': 'createStorageRoute',
  'quiz/route.ts': 'withUserGuards',
  'repos/create-from-workspace/route.ts': 'getOctokitForRequest',
  'repos/create/route.ts': 'requireUserContext',
  'skills/storage/route.ts': 'createStorageRoute',
  'suggestions/route.ts': 'withUserGuards',
  'threads/storage/route.ts': 'createStorageRoute',
  'user/data/route.ts': 'requireUserContext',
  'workspace/storage/list/route.ts': 'requireUserContext',
  'workspace/storage/route.ts': 'requireUserContext',
};

const SOURCE_MARKERS: Record<Boundary, string | null> = {
  public: null,
  requireUserContext: 'requireUserContext(',
  withUserGuards: 'withUserGuards(',
  createStorageRoute: 'createStorageRoute(',
  getOctokitForRequest: 'getOctokitForRequest(',
  verifyCronRequest: 'verifyCronRequest(',
  internalWorkerSecret: 'COPILOT_WORKER_SECRET',
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
        return source.includes(marker) ? null : `${key} missing ${marker}`;
      })
      .filter(Boolean);

    expect(missingMarkers).toEqual([]);
  });
});

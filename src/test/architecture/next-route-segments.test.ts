import { readdirSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const APP_API_ROOT = path.join(process.cwd(), 'src/app/api');

function routeDirectoriesWithPrivateSegments(dir = APP_API_ROOT): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    if (!statSync(fullPath).isDirectory()) return [];
    const relativePath = path.relative(APP_API_ROOT, fullPath).replaceAll(path.sep, '/');
    const current = entry.startsWith('_') ? [relativePath] : [];
    return [...current, ...routeDirectoriesWithPrivateSegments(fullPath)];
  });
}

describe('Next.js API route segments', () => {
  it('does not use underscore-prefixed folders for API routes', () => {
    expect(routeDirectoriesWithPrivateSegments()).toEqual([]);
  });
});

/**
 * @vitest-environment node
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { ChallengeWorkspace } from '@/lib/workspace/types';

const { requireUserContextMock } = vi.hoisted(() => ({
  requireUserContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireUserContext: requireUserContextMock,
  UnauthorizedError: class UnauthorizedError extends Error {
    readonly status = 401;
    constructor(message = 'Authentication required') {
      super(message);
      this.name = 'UnauthorizedError';
    }
  },
}));

const STORAGE_DIR = path.join(
  process.cwd(),
  '.test-artifacts',
  `workspace-storage-route-${Date.now()}-${Math.random().toString(36).slice(2)}`,
);
vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', STORAGE_DIR);

function ctxFor(userId: string) {
  return { userId, login: `u${userId}`, accessToken: `ghu_${userId}` };
}

describe('workspace storage route', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', STORAGE_DIR);
    requireUserContextMock.mockReset();
    await fs.mkdir(STORAGE_DIR, { recursive: true });
  });

  it('returns a generated starter workspace when spec exists but workspace files do not', async () => {
    const { GET } = await import('./route');

    const userId = '5005';
    const challengeId = 'fresh-spec';
    const challengeDir = path.join(STORAGE_DIR, 'users', userId, 'challenges');
    await fs.mkdir(challengeDir, { recursive: true });
    await fs.writeFile(
      path.join(challengeDir, `${challengeId}.json`),
      JSON.stringify({
        id: challengeId,
        title: 'Fresh challenge',
        description: 'Write a function that returns true',
        difficulty: 'beginner',
        language: 'TypeScript',
        estimatedTime: '15 min',
        whyThisChallenge: ['Practice'],
      }),
    );

    requireUserContextMock.mockResolvedValueOnce(ctxFor(userId));
    const read = await GET(new Request(`http://test/api/workspace/storage?challengeId=${challengeId}`) as never);

    expect(read.status).toBe(200);
    const body = (await read.json()) as ChallengeWorkspace;
    expect(body.challengeId).toBe(challengeId);
    expect(body.files.length).toBeGreaterThan(0);
    expect(body.files[0].name).toBe('solution.ts');
    expect(body.files[0].content).toContain('Fresh challenge');
  });

  it('rejects a null JSON body with a 400 instead of crashing', async () => {
    const { POST } = await import('./route');

    requireUserContextMock.mockResolvedValueOnce(ctxFor('5006'));
    const saved = await POST(
      new Request('http://test/api/workspace/storage', {
        method: 'POST',
        body: JSON.stringify(null),
        headers: { 'content-type': 'application/json' },
      }) as never,
    );

    expect(saved.status).toBe(400);
    expect(await saved.json()).toEqual({ error: 'Invalid workspace data' });
  });

  it('rejects an array JSON body with a 400 instead of crashing', async () => {
    const { POST } = await import('./route');

    requireUserContextMock.mockResolvedValueOnce(ctxFor('5007'));
    const saved = await POST(
      new Request('http://test/api/workspace/storage', {
        method: 'POST',
        body: JSON.stringify([]),
        headers: { 'content-type': 'application/json' },
      }) as never,
    );

    expect(saved.status).toBe(400);
    expect(await saved.json()).toEqual({ error: 'Invalid workspace data' });
  });
});

afterAll(async () => {
  try {
    await fs.rm(STORAGE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

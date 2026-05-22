/**
 * Tests for the retention sweeper functions.
 *
 * Each sweep takes a deterministic `nowMs` so tests can assert TTL
 * behaviour without freezing the system clock. Storage is redirected
 * to a tmpdir via `FLIGHT_SCHOOL_DATA_DIR` so writes are isolated per
 * test run.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retention-test-'));
  process.env.FLIGHT_SCHOOL_DATA_DIR = tmpDir;
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.FLIGHT_SCHOOL_DATA_DIR;
});

beforeEach(async () => {
  vi.doUnmock('./utils');
  vi.resetModules();
  // Each test starts from a clean users/ tree so file presence
  // assertions are deterministic.
  await fs.rm(path.join(tmpDir, 'users'), { recursive: true, force: true });
  await fs.rm(path.join(tmpDir, 'background-jobs'), { force: true });
});

async function writeUserThreads(userId: string, threads: Array<{ id: string; updatedAt: string }>) {
  const dir = path.join(tmpDir, 'users', userId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'threads.json'), JSON.stringify({ threads }), 'utf-8');
}

async function writeUserEvaluations(
  userId: string,
  evaluations: Record<string, { status: string; updatedAt?: string }>,
) {
  const dir = path.join(tmpDir, 'users', userId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'evaluations.json'),
    JSON.stringify({ evaluations, version: 1 }),
    'utf-8',
  );
}

async function writeJobScratchpad(
  userId: string,
  filename: string,
  scratchpad: { status?: string; lastUpdated?: string },
) {
  const dir = path.join(tmpDir, 'users', userId, 'jobs');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), JSON.stringify(scratchpad), 'utf-8');
}

async function writeJobsFile(jobs: Record<string, Record<string, unknown>>) {
  await fs.writeFile(path.join(tmpDir, 'background-jobs'), JSON.stringify({ jobs, version: 1 }), 'utf-8');
}

describe('sweepThreadsForUser', () => {
  it('keeps threads inside the TTL window', async () => {
    const { sweepThreadsForUser, RETENTION_TTL } = await import('./retention');
    const now = Date.UTC(2024, 0, 10);
    await writeUserThreads('u-keep', [
      { id: 't1', updatedAt: new Date(now - 60_000).toISOString() },
    ]);

    const result = await sweepThreadsForUser('u-keep', now, RETENTION_TTL.threadMs);
    expect(result).toEqual({ deleted: 0, inspected: 1 });

    const raw = await fs.readFile(
      path.join(tmpDir, 'users', 'u-keep', 'threads.json'),
      'utf-8',
    );
    expect(JSON.parse(raw).threads).toHaveLength(1);
  });

  it('drops threads older than the TTL', async () => {
    const { sweepThreadsForUser } = await import('./retention');
    const now = Date.UTC(2024, 0, 10);
    const ttl = 1000;
    await writeUserThreads('u-mix', [
      { id: 'fresh', updatedAt: new Date(now - 500).toISOString() },
      { id: 'stale', updatedAt: new Date(now - 5000).toISOString() },
    ]);

    const result = await sweepThreadsForUser('u-mix', now, ttl);
    expect(result).toEqual({ deleted: 1, inspected: 2 });

    const raw = await fs.readFile(
      path.join(tmpDir, 'users', 'u-mix', 'threads.json'),
      'utf-8',
    );
    const parsed = JSON.parse(raw) as { threads: Array<{ id: string }> };
    expect(parsed.threads.map((t) => t.id)).toEqual(['fresh']);
  });

  it('keeps threads exactly at the TTL boundary and drops older threads', async () => {
    const { sweepThreadsForUser } = await import('./retention');
    const now = Date.UTC(2024, 0, 10);
    const ttl = 1000;
    await writeUserThreads('u-boundary', [
      { id: 'boundary', updatedAt: new Date(now - ttl).toISOString() },
      { id: 'stale', updatedAt: new Date(now - ttl - 1).toISOString() },
    ]);

    const result = await sweepThreadsForUser('u-boundary', now, ttl);
    expect(result).toEqual({ deleted: 1, inspected: 2 });

    const raw = await fs.readFile(
      path.join(tmpDir, 'users', 'u-boundary', 'threads.json'),
      'utf-8',
    );
    expect(JSON.parse(raw).threads.map((thread: { id: string }) => thread.id)).toEqual([
      'boundary',
    ]);
  });

  it('removes the file entirely when every thread is stale', async () => {
    const { sweepThreadsForUser } = await import('./retention');
    const now = Date.UTC(2024, 0, 10);
    const ttl = 1000;
    await writeUserThreads('u-empty', [
      { id: 'stale-1', updatedAt: new Date(now - 5000).toISOString() },
      { id: 'stale-2', updatedAt: new Date(now - 6000).toISOString() },
    ]);

    const result = await sweepThreadsForUser('u-empty', now, ttl);
    expect(result).toEqual({ deleted: 2, inspected: 2 });

    await expect(
      fs.access(path.join(tmpDir, 'users', 'u-empty', 'threads.json')),
    ).rejects.toThrow();
  });

  it('is a no-op for missing files', async () => {
    const { sweepThreadsForUser } = await import('./retention');
    const result = await sweepThreadsForUser('never-existed', Date.now());
    expect(result).toEqual({ deleted: 0, inspected: 0 });
  });

  it('rejects unsafe userId values', async () => {
    const { sweepThreadsForUser } = await import('./retention');
    const result = await sweepThreadsForUser('../escape', Date.now());
    expect(result).toEqual({ deleted: 0, inspected: 0 });
  });

  it('propagates storage read failures instead of returning a success-shaped fallback', async () => {
    vi.resetModules();
    vi.doMock('./utils', async () => {
      const actual = await vi.importActual<typeof import('./utils')>('./utils');
      return {
        ...actual,
        readFile: vi.fn().mockRejectedValue(new Error('disk offline')),
      };
    });
    const { sweepThreadsForUser } = await import('./retention');

    await expect(sweepThreadsForUser('u-error', Date.now())).rejects.toThrow('disk offline');
  });
});

describe('sweepAllUsers', () => {
  it('deletes terminal scratchpads after the TTL', async () => {
    const { RETENTION_TTL, sweepAllUsers } = await import('./retention');
    const now = Date.UTC(2024, 0, 10);
    await writeJobScratchpad('u-scratch', 'fresh.json', {
      status: 'completed',
      lastUpdated: new Date(now - RETENTION_TTL.scratchpadMs).toISOString(),
    });
    await writeJobScratchpad('u-scratch', 'stale.json', {
      status: 'completed',
      lastUpdated: new Date(now - RETENTION_TTL.scratchpadMs - 1).toISOString(),
    });

    const result = await sweepAllUsers(now);
    expect(result.scratchpads).toEqual({ deleted: 1, inspected: 2 });
    await expect(
      fs.access(path.join(tmpDir, 'users', 'u-scratch', 'jobs', 'fresh.json')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(tmpDir, 'users', 'u-scratch', 'jobs', 'stale.json')),
    ).rejects.toThrow();
  });

  it('deletes terminal evaluations after the TTL', async () => {
    const { RETENTION_TTL, sweepAllUsers } = await import('./retention');
    const now = Date.UTC(2024, 0, 10);
    await writeUserEvaluations('u-eval', {
      fresh: { status: 'completed', updatedAt: new Date(now - RETENTION_TTL.evaluationMs).toISOString() },
      stale: { status: 'failed', updatedAt: new Date(now - RETENTION_TTL.evaluationMs - 1).toISOString() },
      pending: { status: 'pending', updatedAt: new Date(now - RETENTION_TTL.evaluationMs - 1).toISOString() },
    });

    const result = await sweepAllUsers(now);
    expect(result.evaluations).toEqual({ deleted: 1, inspected: 3 });

    const raw = await fs.readFile(
      path.join(tmpDir, 'users', 'u-eval', 'evaluations.json'),
      'utf-8',
    );
    expect(Object.keys(JSON.parse(raw).evaluations)).toEqual(['fresh', 'pending']);
  });

  it('ignores unsafe user directory names', async () => {
    const { sweepAllUsers } = await import('./retention');
    const unsafeDir = path.join(tmpDir, 'users', 'bad.user');
    await fs.mkdir(unsafeDir, { recursive: true });
    await fs.writeFile(
      path.join(unsafeDir, 'threads.json'),
      JSON.stringify({ threads: [{ id: 'stale', updatedAt: '2020-01-01T00:00:00.000Z' }] }),
      'utf-8',
    );

    const result = await sweepAllUsers(Date.UTC(2024, 0, 10));
    expect(result.threads).toEqual({ deleted: 0, inspected: 0 });
    await expect(fs.access(path.join(unsafeDir, 'threads.json'))).resolves.toBeUndefined();
  });
});

describe('job retention sweepers', () => {
  it('marks stale running jobs as failed', async () => {
    const { sweepStaleRunningJobs } = await import('./retention');
    const { jobStorage } = await import('@/lib/jobs');
    const now = Date.UTC(2024, 0, 10);
    await jobStorage.create({
      id: 'stale-running',
      type: 'chat-response',
      userId: 'u-jobs',
      input: {},
    });
    await jobStorage.markRunning('stale-running');
    await jobStorage.update('stale-running', {
      startedAt: new Date(now - 2000).toISOString(),
    });

    const result = await sweepStaleRunningJobs(now, 1000);
    expect(result).toEqual({ deleted: 1, inspected: 1 });
    await expect(jobStorage.get('stale-running')).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'unknown',
    });
  });

  it('deletes orphan jobs without a userId', async () => {
    const { sweepOrphanJobs } = await import('./retention');
    const { jobStorage } = await import('@/lib/jobs');
    await writeJobsFile({
      orphan: {
        id: 'orphan',
        type: 'chat-response',
        status: 'completed',
        input: {},
        createdAt: '2024-01-01T00:00:00.000Z',
      },
      owned: {
        id: 'owned',
        type: 'chat-response',
        userId: 'u-jobs',
        status: 'completed',
        input: {},
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    });
    jobStorage.invalidateCache();

    const result = await sweepOrphanJobs();
    expect(result).toEqual({ deleted: 1, inspected: 2 });
    await expect(jobStorage.get('orphan')).resolves.toBeUndefined();
    await expect(jobStorage.get('owned')).resolves.toMatchObject({ id: 'owned' });
  });
});

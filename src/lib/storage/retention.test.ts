/**
 * Tests for the retention sweeper functions.
 *
 * Each sweep takes a deterministic `nowMs` so tests can assert TTL
 * behaviour without freezing the system clock. Storage is redirected
 * to a tmpdir via `FLIGHT_SCHOOL_DATA_DIR` so writes are isolated per
 * test run.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  // Each test starts from a clean users/ tree so file presence
  // assertions are deterministic.
  await fs.rm(path.join(tmpDir, 'users'), { recursive: true, force: true });
});

async function writeUserThreads(userId: string, threads: Array<{ id: string; updatedAt: string }>) {
  const dir = path.join(tmpDir, 'users', userId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'threads.json'), JSON.stringify({ threads }), 'utf-8');
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
});

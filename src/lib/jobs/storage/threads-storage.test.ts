/**
 * Behaviour contract for the per-user thread store after it moved onto the
 * envelope {@link import('@/lib/storage/document-store/singleton-repo')} via the
 * `'threads.json'` container mapping.
 *
 * A characterization test: it locks the observable behaviour (default read,
 * round-trip, by-id lookup with legacy-cursor stripping, update semantics,
 * tombstone silent-abort, tenancy isolation) across the flat-file → envelope
 * refactor. Exercises the REAL document store over a temp data dir; only the
 * deletion-tombstone seam is mocked.
 *
 * @module jobs/storage/threads-storage.test
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Thread } from '@/lib/threads';

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `fs-threads-storage-${Date.now()}`);

const isUserDeletedMock = vi.fn(async (): Promise<boolean> => false);

vi.mock('@/lib/storage/tombstone', () => ({
  isUserDeleted: (userId: string) => isUserDeletedMock(userId),
}));

type ThreadsModule = typeof import('./threads-storage');
let mod: ThreadsModule;

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    title: 'A thread',
    context: {} as Thread['context'],
    messages: [],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeAll(async () => {
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);
  await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
  mod = await import('./threads-storage');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  isUserDeletedMock.mockReset();
  isUserDeletedMock.mockResolvedValue(false);
});

describe('threads-storage envelope round-trip', () => {
  it('returns an empty list when nothing is stored', async () => {
    expect(await mod.readThreadsStorage('thr-user-empty')).toEqual([]);
  });

  it('persists written threads and reads them back', async () => {
    const threads = [makeThread({ id: 'a' }), makeThread({ id: 'b' })];
    await mod.writeThreadsStorage('thr-user-rt', threads);
    expect(await mod.readThreadsStorage('thr-user-rt')).toEqual(threads);
  });

  it('getThreadById returns the matching thread and null when absent', async () => {
    await mod.writeThreadsStorage('thr-user-get', [makeThread({ id: 'found' })]);
    expect(await mod.getThreadById('thr-user-get', 'found')).not.toBeNull();
    expect(await mod.getThreadById('thr-user-get', 'missing')).toBeNull();
  });

  it('getThreadById strips the legacy ▊ cursor glyph from assistant messages', async () => {
    const thread = makeThread({
      id: 'cursor',
      messages: [{ role: 'assistant', content: 'partial answer ▊' }] as Thread['messages'],
    });
    await mod.writeThreadsStorage('thr-user-cursor', [thread]);

    const read = await mod.getThreadById('thr-user-cursor', 'cursor');
    expect(read?.messages[0].content).toBe('partial answer');
  });
});

describe('threads-storage updateThread', () => {
  it('replaces an existing thread and stamps a fresh updatedAt', async () => {
    await mod.writeThreadsStorage('thr-user-upd', [makeThread({ id: 'x', title: 'old' })]);

    await mod.updateThread('thr-user-upd', makeThread({ id: 'x', title: 'new' }));

    const stored = await mod.readThreadsStorage('thr-user-upd');
    expect(stored).toHaveLength(1);
    expect(stored[0].title).toBe('new');
    expect(stored[0].updatedAt).not.toBe('2026-05-01T00:00:00.000Z');
  });

  it('prepends a new thread to the front when its id is unknown', async () => {
    await mod.writeThreadsStorage('thr-user-new', [makeThread({ id: 'existing' })]);

    await mod.updateThread('thr-user-new', makeThread({ id: 'fresh' }));

    const stored = await mod.readThreadsStorage('thr-user-new');
    expect(stored.map((t) => t.id)).toEqual(['fresh', 'existing']);
  });
});

describe('threads-storage tenancy + tombstone', () => {
  it('keeps two users their own threads', async () => {
    await mod.writeThreadsStorage('thr-user-a', [makeThread({ id: 'a-only' })]);
    await mod.writeThreadsStorage('thr-user-b', [makeThread({ id: 'b-only' })]);

    expect((await mod.readThreadsStorage('thr-user-a')).map((t) => t.id)).toEqual(['a-only']);
    expect((await mod.readThreadsStorage('thr-user-b')).map((t) => t.id)).toEqual(['b-only']);
  });

  it('silently aborts a write for a tombstoned user without throwing', async () => {
    isUserDeletedMock.mockResolvedValue(true);

    await expect(mod.writeThreadsStorage('thr-user-deleted', [makeThread({ id: 'ghost' })])).resolves.toBeUndefined();

    isUserDeletedMock.mockResolvedValue(false);
    expect(await mod.readThreadsStorage('thr-user-deleted')).toEqual([]);
  });
});

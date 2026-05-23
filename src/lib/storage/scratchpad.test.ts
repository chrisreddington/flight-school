/**
 * Tests for the per-job streaming scratchpad. We redirect storage to a
 * tmpdir via `FLIGHT_SCHOOL_DATA_DIR` for isolation. The tombstone
 * helper is mocked so we can flip the "user is deleted" gate without
 * having to write a real tombstone file.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { Thread } from '@/lib/threads';

const isUserDeletedMock = vi.fn().mockResolvedValue(false);

vi.mock('./tombstone', () => ({
  isUserDeleted: (...args: unknown[]) => isUserDeletedMock(...args),
}));

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scratchpad-test-'));
  process.env.FLIGHT_SCHOOL_DATA_DIR = tmpDir;
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.FLIGHT_SCHOOL_DATA_DIR;
});

beforeEach(async () => {
  await fs.rm(path.join(tmpDir, 'users'), { recursive: true, force: true });
  isUserDeletedMock.mockResolvedValue(false);
});

afterEach(() => {
  isUserDeletedMock.mockReset();
  isUserDeletedMock.mockResolvedValue(false);
});

describe('writeScratchpad / readScratchpad', () => {
  it('round-trips a scratchpad payload', async () => {
    const { writeScratchpad, readScratchpad } = await import('./scratchpad');

    await writeScratchpad('u-1', 'job-A', {
      threadId: 't-1',
      assistantMessageId: 'msg-1',
      content: 'hello world',
      hasActionableItem: false,
      status: 'streaming',
    });

    const sp = await readScratchpad('u-1', 'job-A');
    expect(sp).not.toBeNull();
    expect(sp?.assistantMessageId).toBe('msg-1');
    expect(sp?.content).toBe('hello world');
    expect(sp?.status).toBe('streaming');
    expect(typeof sp?.lastUpdated).toBe('string');
  });

  it('is a no-op when the user tombstone is set', async () => {
    const { writeScratchpad, readScratchpad } = await import('./scratchpad');
    isUserDeletedMock.mockResolvedValue(true);

    await writeScratchpad('u-1', 'job-B', {
      threadId: 't-1',
      assistantMessageId: 'msg-1',
      content: 'should not persist',
      status: 'streaming',
    });

    expect(await readScratchpad('u-1', 'job-B')).toBeNull();
  });

  it('rejects unsafe userId / jobId', async () => {
    const { writeScratchpad } = await import('./scratchpad');
    await expect(
      writeScratchpad('../evil', 'job-A', {
        threadId: 't', assistantMessageId: 'm', content: '', status: 'streaming',
      }),
    ).rejects.toThrow(/unsafe userId/);
    await expect(
      writeScratchpad('u-1', '../escape', {
        threadId: 't', assistantMessageId: 'm', content: '', status: 'streaming',
      }),
    ).rejects.toThrow(/unsafe jobId/);
  });

  it('readScratchpad returns null for missing file', async () => {
    const { readScratchpad } = await import('./scratchpad');
    expect(await readScratchpad('u-none', 'job-none')).toBeNull();
  });
});

describe('deleteScratchpad', () => {
  it('removes an existing file and is idempotent', async () => {
    const { writeScratchpad, readScratchpad, deleteScratchpad } = await import('./scratchpad');
    await writeScratchpad('u-1', 'job-A', {
      threadId: 't', assistantMessageId: 'm', content: 'x', status: 'streaming',
    });
    expect(await readScratchpad('u-1', 'job-A')).not.toBeNull();

    await deleteScratchpad('u-1', 'job-A');
    expect(await readScratchpad('u-1', 'job-A')).toBeNull();

    // second delete must not throw
    await expect(deleteScratchpad('u-1', 'job-A')).resolves.toBeUndefined();
  });
});

describe('listScratchpadsByMessageId', () => {
  it('indexes scratchpads by assistantMessageId and skips corrupt files', async () => {
    const { writeScratchpad, listScratchpadsByMessageId } = await import('./scratchpad');

    await writeScratchpad('u-2', 'job-1', {
      threadId: 't', assistantMessageId: 'msg-AAA', content: 'a', status: 'streaming',
    });
    await writeScratchpad('u-2', 'job-2', {
      threadId: 't', assistantMessageId: 'msg-BBB', content: 'b', status: 'completed',
    });

    // drop a non-JSON file in the same dir to ensure the loader skips it
    const subdir = path.join(tmpDir, 'users', 'u-2', 'jobs');
    await fs.writeFile(path.join(subdir, 'garbage.json'), '{ not valid json', 'utf-8');

    const map = await listScratchpadsByMessageId('u-2');
    expect(map.size).toBe(2);
    expect(map.get('msg-AAA')?.content).toBe('a');
    expect(map.get('msg-BBB')?.status).toBe('completed');
  });

  it('returns an empty map for an unsafe userId', async () => {
    const { listScratchpadsByMessageId } = await import('./scratchpad');
    expect((await listScratchpadsByMessageId('../bad')).size).toBe(0);
  });
});

describe('hydrateThreadsWithScratchpads', () => {
  function makeThread(id: string, assistantMessageId: string, content = ''): Thread {
    return {
      id,
      title: 't',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [
        { id: 'u', role: 'user', content: 'hi', timestamp: new Date().toISOString() },
        { id: assistantMessageId, role: 'assistant', content, timestamp: new Date().toISOString() },
      ],
    } as Thread;
  }

  it('merges streaming scratchpad content into the matching assistant message', async () => {
    const { writeScratchpad, hydrateThreadsWithScratchpads } = await import('./scratchpad');
    await writeScratchpad('u-3', 'job-1', {
      threadId: 't1',
      assistantMessageId: 'asst-1',
      content: 'partial response',
      status: 'streaming',
    });

    const hydrated = await hydrateThreadsWithScratchpads('u-3', [makeThread('t1', 'asst-1', '')]);
    expect(hydrated[0].isStreaming).toBe(true);
    const asst = hydrated[0].messages.find((m) => m.id === 'asst-1');
    expect(asst?.content).toBe('partial response ▊');
  });

  it('does not append cursor for completed scratchpads', async () => {
    const { writeScratchpad, hydrateThreadsWithScratchpads } = await import('./scratchpad');
    await writeScratchpad('u-4', 'job-1', {
      threadId: 't1',
      assistantMessageId: 'asst-1',
      content: 'done.',
      status: 'completed',
    });

    const hydrated = await hydrateThreadsWithScratchpads('u-4', [makeThread('t1', 'asst-1', '')]);
    const asst = hydrated[0].messages.find((m) => m.id === 'asst-1');
    expect(asst?.content).toBe('done.');
  });

  it('returns input unchanged when no scratchpads exist', async () => {
    const { hydrateThreadsWithScratchpads } = await import('./scratchpad');
    const threads = [makeThread('t1', 'asst-1', 'original')];
    const out = await hydrateThreadsWithScratchpads('u-empty', threads);
    expect(out).toEqual(threads);
  });

  it('leaves unrelated assistant messages untouched', async () => {
    const { writeScratchpad, hydrateThreadsWithScratchpads } = await import('./scratchpad');
    await writeScratchpad('u-5', 'job-1', {
      threadId: 't1',
      assistantMessageId: 'asst-MATCH',
      content: 'streamed',
      status: 'streaming',
    });

    const hydrated = await hydrateThreadsWithScratchpads('u-5', [
      makeThread('t1', 'asst-OTHER', 'kept'),
    ]);
    expect(hydrated[0].isStreaming).toBeUndefined();
    expect(hydrated[0].messages.find((m) => m.id === 'asst-OTHER')?.content).toBe('kept');
  });
});

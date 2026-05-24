import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AIActivityEvent } from './types';

const mocks = vi.hoisted(() => ({
  ensureDir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
}));

vi.mock('@/lib/storage/utils', () => ({
  ensureDir: mocks.ensureDir,
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
  deleteFile: mocks.deleteFile,
}));

import {
  appendActivityEvent,
  clearActivityEvents,
  loadActivityEvents,
} from './activity-store';

function mkEvent(overrides: Partial<AIActivityEvent> = {}): AIActivityEvent {
  return {
    id: 'evt-1',
    userId: 'user-1',
    timestamp: new Date('2026-05-24T00:00:01.000Z'),
    type: 'ask',
    operation: 'ask',
    latencyMs: 0,
    status: 'pending',
    ...overrides,
  };
}

describe('activity-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readFile.mockResolvedValue(null);
  });

  it('appends activity events to durable worker-local storage', async () => {
    await appendActivityEvent(mkEvent());

    expect(mocks.ensureDir).toHaveBeenCalledWith('users/user-1/activity', { mode: 0o700 });
    expect(mocks.writeFile).toHaveBeenCalledWith(
      'users/user-1/activity',
      'events.json',
      expect.any(String),
    );
    const written = JSON.parse(mocks.writeFile.mock.calls[0][2]) as {
      events: Array<{ id: string; timestamp: string }>;
    };
    expect(written.events[0]).toEqual(
      expect.objectContaining({
        id: 'evt-1',
        timestamp: '2026-05-24T00:00:01.000Z',
      }),
    );
  });

  it('replaces an existing event with the same id', async () => {
    mocks.readFile.mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        events: [
          {
            id: 'evt-1',
            userId: 'user-1',
            timestamp: '2026-05-24T00:00:00.000Z',
            type: 'ask',
            operation: 'ask',
            latencyMs: 0,
            status: 'pending',
          },
        ],
      }),
    );

    await appendActivityEvent(mkEvent({ status: 'success', latencyMs: 42 }));

    const written = JSON.parse(mocks.writeFile.mock.calls[0][2]) as {
      events: Array<{ status: string; latencyMs: number }>;
    };
    expect(written.events).toHaveLength(1);
    expect(written.events[0].status).toBe('success');
    expect(written.events[0].latencyMs).toBe(42);
  });

  it('loads stored events back into Date objects', async () => {
    mocks.readFile.mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        events: [
          {
            id: 'evt-1',
            userId: 'user-1',
            timestamp: '2026-05-24T00:00:01.000Z',
            type: 'ask',
            operation: 'ask',
            latencyMs: 0,
            status: 'pending',
          },
        ],
      }),
    );

    const events = await loadActivityEvents('user-1');

    expect(events).toHaveLength(1);
    expect(events[0].timestamp).toBeInstanceOf(Date);
    expect(events[0].id).toBe('evt-1');
  });

  it('clears stored events for one user', async () => {
    await clearActivityEvents('user-1');

    expect(mocks.deleteFile).toHaveBeenCalledWith('users/user-1/activity', 'events.json');
  });

  it('serializes concurrent writes per user so updates are not lost', async () => {
    // Both writers see an empty store before either has finished writing.
    // Without the per-user mutex, the second writer would clobber the first.
    mocks.readFile.mockResolvedValue(null);

    let resolveFirstWrite!: () => void;
    const firstWriteGate = new Promise<void>((resolve) => {
      resolveFirstWrite = resolve;
    });
    let writeCall = 0;
    mocks.writeFile.mockImplementation(async () => {
      writeCall += 1;
      if (writeCall === 1) {
        await firstWriteGate;
      }
    });

    // After the first write resolves, the second read should see the
    // first event so the second writer can merge with it.
    mocks.readFile
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(async () => {
        return JSON.stringify({
          version: 1,
          events: [
            {
              id: 'evt-1',
              userId: 'user-1',
              timestamp: '2026-05-24T00:00:01.000Z',
              type: 'ask',
              operation: 'ask',
              latencyMs: 0,
              status: 'pending',
            },
          ],
        });
      });

    const first = appendActivityEvent(mkEvent({ id: 'evt-1' }));
    const second = appendActivityEvent(mkEvent({ id: 'evt-2' }));

    // The second write must not start until the first resolves. Wait
    // until the first reaches writeFile, then verify the second hasn't.
    while (mocks.writeFile.mock.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    // Give a few extra microtasks to confirm the second writer is genuinely
    // gated and not just slow to start.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);

    resolveFirstWrite();
    await Promise.all([first, second]);

    expect(mocks.writeFile).toHaveBeenCalledTimes(2);
    const final = JSON.parse(
      mocks.writeFile.mock.calls.at(-1)![2] as string,
    ) as { events: Array<{ id: string }> };
    expect(final.events.map((e) => e.id)).toEqual(['evt-1', 'evt-2']);
  });
});

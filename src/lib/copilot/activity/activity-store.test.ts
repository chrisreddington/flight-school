import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserDeletedError } from '@/lib/storage/document-store/user-scoped-store';
import { MIGRATABLE_SINGLETON_FILENAMES } from '@/lib/storage/document-store/user-storage-core';
import type { AIActivityEvent } from './types';

/**
 * In-memory fake of the user-scoped envelope store. Activity persists through
 * `getUserScopedStoreForUser`, so the tests mock that seam and back it with a
 * per-user Map. `putGate`/`putError` let individual tests gate or fail a write
 * to exercise the per-user mutex and the tombstone swallow.
 */
const stores = vi.hoisted(() => ({
  data: new Map<string, unknown>(),
  putCalls: [] as Array<{ container: string; id: string; body: unknown }>,
  putGate: null as null | Promise<void>,
  putError: null as null | Error,
}));

vi.mock('@/lib/storage/document-store/scoped-store', () => ({
  getUserScopedStoreForUser: async (userId: string) => ({
    get: async (container: string, id: string) => stores.data.get(`${userId}:${container}:${id}`) ?? null,
    put: async (container: string, id: string, body: unknown) => {
      stores.putCalls.push({ container, id, body });
      if (stores.putGate) await stores.putGate;
      if (stores.putError) throw stores.putError;
      stores.data.set(`${userId}:${container}:${id}`, body);
      return { body };
    },
    remove: async (container: string, id: string) => {
      stores.data.delete(`${userId}:${container}:${id}`);
    },
  }),
}));

import { appendActivityEvent, clearActivityEvents, loadActivityEvents } from './activity-store';

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

function lastPutBody(): {
  version: number;
  events: Array<{ id: string; timestamp: string; status?: string; latencyMs?: number }>;
} {
  return stores.putCalls.at(-1)!.body as never;
}

describe('activity-store', () => {
  beforeEach(() => {
    stores.data.clear();
    stores.putCalls.length = 0;
    stores.putGate = null;
    stores.putError = null;
  });

  it('persists events to the activity singleton with serialized timestamps', async () => {
    await appendActivityEvent(mkEvent());

    expect(stores.putCalls).toHaveLength(1);
    expect(stores.putCalls[0].container).toBe('activity');
    expect(stores.putCalls[0].id).toBe('current');
    expect(lastPutBody().events[0]).toEqual(
      expect.objectContaining({ id: 'evt-1', timestamp: '2026-05-24T00:00:01.000Z' }),
    );
  });

  it('replaces an existing event with the same id', async () => {
    stores.data.set('user-1:activity:current', {
      version: 1,
      events: [serialized('evt-1', 'pending', 0)],
    });

    await appendActivityEvent(mkEvent({ status: 'success', latencyMs: 42 }));

    const events = lastPutBody().events;
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('success');
    expect(events[0].latencyMs).toBe(42);
  });

  it('trims the stored ring buffer to the 400 most recent events', async () => {
    const existing = Array.from({ length: 400 }, (_unused, index) => serialized(`old-${index}`, 'success', 0));
    stores.data.set('user-1:activity:current', { version: 1, events: existing });

    await appendActivityEvent(mkEvent({ id: 'newest' }));

    const events = lastPutBody().events;
    expect(events).toHaveLength(400);
    expect(events.at(-1)!.id).toBe('newest');
    expect(events[0].id).toBe('old-1');
  });

  it('loads stored events back into Date objects', async () => {
    stores.data.set('user-1:activity:current', {
      version: 1,
      events: [serialized('evt-1', 'pending', 0)],
    });

    const events = await loadActivityEvents('user-1');

    expect(events).toHaveLength(1);
    expect(events[0].timestamp).toBeInstanceOf(Date);
    expect(events[0].id).toBe('evt-1');
  });

  it('clears stored events for one user', async () => {
    stores.data.set('user-1:activity:current', { version: 1, events: [serialized('evt-1', 'pending', 0)] });

    await clearActivityEvents('user-1');

    expect(stores.data.has('user-1:activity:current')).toBe(false);
  });

  it('swallows UserDeletedError when the account is tombstoned mid-write', async () => {
    stores.putError = new UserDeletedError('user-1');

    await expect(appendActivityEvent(mkEvent())).resolves.toBeUndefined();
  });

  it('serializes concurrent writes per user so updates are not lost', async () => {
    let releaseFirstWrite!: () => void;
    stores.putGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });

    const first = appendActivityEvent(mkEvent({ id: 'evt-1' }));
    const second = appendActivityEvent(mkEvent({ id: 'evt-2' }));

    // The second write must not start until the first resolves.
    while (stores.putCalls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(stores.putCalls).toHaveLength(1);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(stores.putCalls).toHaveLength(1);

    stores.putGate = null;
    releaseFirstWrite();
    await Promise.all([first, second]);

    expect(stores.putCalls).toHaveLength(2);
    expect(lastPutBody().events.map((event) => event.id)).toEqual(['evt-1', 'evt-2']);
  });
});

describe('activity container mapping', () => {
  it('is intentionally excluded from the migratable singletons', () => {
    // Activity is a disposable rehydration cache stored at a nested path, so it
    // must never appear in the filename→container migration map.
    expect(MIGRATABLE_SINGLETON_FILENAMES).not.toContain('activity');
    expect(MIGRATABLE_SINGLETON_FILENAMES).not.toContain('events.json');
  });
});

function serialized(id: string, status: string, latencyMs: number) {
  return {
    id,
    userId: 'user-1',
    timestamp: '2026-05-24T00:00:01.000Z',
    type: 'ask',
    operation: 'ask',
    latencyMs,
    status,
  };
}

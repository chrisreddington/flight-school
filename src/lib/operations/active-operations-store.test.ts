import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveOperationsStore, type ActiveOperationEntry } from './active-operations-store';

const BASE_TIME = new Date('2026-01-25T00:00:00.000Z');

describe('ActiveOperationsStore', () => {
  let store: ActiveOperationsStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    store = new ActiveOperationsStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should add and return active entries', async () => {
    const entry: ActiveOperationEntry = {
      itemId: 'topic-1',
      itemType: 'topic',
      jobId: 'job-1',
      startedAt: BASE_TIME.toISOString(),
    };

    await store.addEntry(entry);

    const entries = await store.getEntries();
    expect(entries).toEqual([entry]);
  });

  it('should remove entries by jobId', async () => {
    const entry: ActiveOperationEntry = {
      itemId: 'goal-1',
      itemType: 'goal',
      jobId: 'job-2',
      startedAt: BASE_TIME.toISOString(),
    };

    await store.addEntry(entry);
    await store.removeByJobId('job-2');

    const entries = await store.getEntries();
    expect(entries).toEqual([]);
  });

  it('should prune entries older than the TTL', async () => {
    const expiredEntry: ActiveOperationEntry = {
      itemId: 'challenge-1',
      itemType: 'challenge',
      jobId: 'job-3',
      startedAt: new Date(BASE_TIME.getTime() - 6 * 60 * 1000).toISOString(),
    };

    await store.addEntry(expiredEntry);

    const entries = await store.getEntries();
    expect(entries).toEqual([]);
  });
});

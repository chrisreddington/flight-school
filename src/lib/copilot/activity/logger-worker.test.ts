import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AIActivityEvent } from './types';

const mocks = vi.hoisted(() => ({
  loadActivityEvents: vi.fn(),
  appendActivityEvent: vi.fn(),
  clearActivityEvents: vi.fn(),
}));

vi.mock('./activity-store', () => ({
  loadActivityEvents: mocks.loadActivityEvents,
  appendActivityEvent: mocks.appendActivityEvent,
  clearActivityEvents: mocks.clearActivityEvents,
}));

import { activityLoggerWorker } from './logger-worker';

function mkEvent(overrides: Partial<AIActivityEvent> = {}): AIActivityEvent {
  return {
    id: 'evt-hydrated',
    userId: 'user-1',
    timestamp: new Date('2026-05-24T00:00:00.000Z'),
    type: 'ask',
    operation: 'ask',
    latencyMs: 0,
    status: 'pending',
    ...overrides,
  };
}

describe('AIActivityLoggerWorker', () => {
  beforeEach(() => {
    activityLoggerWorker.__resetForTests();
    vi.clearAllMocks();
    mocks.loadActivityEvents.mockResolvedValue([]);
    mocks.appendActivityEvent.mockResolvedValue(undefined);
    mocks.clearActivityEvents.mockResolvedValue(undefined);
  });

  it('hydration loads stored events into the bus and applyUpdate finds them by id', async () => {
    // Regression: previously hydration only seeded the bus; applyUpdate
    // checked an independent in-memory map and returned null (→ 404)
    // for retained events after worker restart.
    mocks.loadActivityEvents.mockResolvedValueOnce([
      mkEvent({ id: 'evt-hydrated', status: 'pending' }),
    ]);

    await activityLoggerWorker.ensureHydrated('user-1');

    const updated = activityLoggerWorker.applyUpdate('user-1', 'evt-hydrated', {
      status: 'success',
      output: { content: 'done' },
    });

    expect(updated).not.toBeNull();
    expect(updated?.status).toBe('success');
    expect(activityLoggerWorker.getEvents('user-1').map((e) => e.status)).toEqual([
      'success',
    ]);
  });

  it('applyUpdate returns null when the event id is unknown or owned by another user', async () => {
    mocks.loadActivityEvents.mockResolvedValueOnce([
      mkEvent({ id: 'evt-1', userId: 'user-1' }),
    ]);
    await activityLoggerWorker.ensureHydrated('user-1');

    expect(activityLoggerWorker.applyUpdate('user-1', 'ghost', { status: 'success' })).toBeNull();
    expect(activityLoggerWorker.applyUpdate('user-2', 'evt-1', { status: 'success' })).toBeNull();
  });

  it('startOperation creates a pending event, persists it, and completes via the returned closure', async () => {
    const { eventId, complete } = activityLoggerWorker.startOperation(
      'user-1',
      'ask',
      'test-op',
    );

    expect(eventId).toBeDefined();
    expect(mocks.appendActivityEvent).toHaveBeenCalledTimes(1);
    expect(mocks.appendActivityEvent.mock.calls[0][0].status).toBe('pending');

    complete({ content: 'ok' }, undefined, { firstTokenMs: 12, totalMs: 34 });

    const events = activityLoggerWorker.getEvents('user-1');
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('success');
    expect(events[0].input?.serverMetrics).toEqual({ firstTokenMs: 12, totalMs: 34 });
  });

  it('clear() wipes the bus, hydration marker, and durable store', async () => {
    mocks.loadActivityEvents.mockResolvedValueOnce([mkEvent({ id: 'evt-1' })]);
    await activityLoggerWorker.ensureHydrated('user-1');
    expect(activityLoggerWorker.getEvents('user-1')).toHaveLength(1);

    await activityLoggerWorker.clear('user-1');

    expect(activityLoggerWorker.getEvents('user-1')).toEqual([]);
    expect(mocks.clearActivityEvents).toHaveBeenCalledWith('user-1');
  });

  it('clear() propagates durable-store delete failures so partial-failure can be surfaced', async () => {
    mocks.clearActivityEvents.mockRejectedValueOnce(new Error('disk gone'));
    await expect(activityLoggerWorker.clear('user-1')).rejects.toThrow(/disk gone/);
  });

  it('repeat hydration does not re-broadcast or duplicate events', async () => {
    // Regression: previously ensureHydrated used activityBus.append(), which
    // broadcasted to subscribers AND would duplicate events if a live append
    // had already added one of the stored ids to the bus.
    mocks.loadActivityEvents.mockResolvedValue([mkEvent({ id: 'evt-1' })]);

    // Live append before hydration completes (in-process caller race).
    activityLoggerWorker.logEvent('user-1', 'ask', 'live-op');
    const liveBefore = activityLoggerWorker.getEvents('user-1').length;

    await activityLoggerWorker.ensureHydrated('user-1');

    const afterHydrate = activityLoggerWorker.getEvents('user-1');
    // No duplicate of 'evt-1', and the live event is preserved.
    expect(afterHydrate.filter((e) => e.id === 'evt-1')).toHaveLength(1);
    expect(afterHydrate.length).toBe(liveBefore + 1);
  });

  it('applyUpdate uses copy-on-write so a queued persist captures a stable snapshot', () => {
    // Regression: previously applyUpdate mutated the bus event in place,
    // so any retained reference (e.g. captured by an earlier persist task
    // that had not yet serialized) would observe the later mutation.
    const { eventId } = activityLoggerWorker.startOperation('user-1', 'ask', 'op');
    const beforeUpdate = activityLoggerWorker.getEvents('user-1')[0];

    const updated = activityLoggerWorker.applyUpdate('user-1', eventId, {
      status: 'success',
      output: { content: 'ok' },
    });

    expect(updated).not.toBeNull();
    // The bus now holds the updated copy.
    expect(activityLoggerWorker.getEvents('user-1')[0].status).toBe('success');
    // The pre-update reference snapshot is untouched.
    expect(beforeUpdate.status).toBe('pending');
    expect(beforeUpdate).not.toBe(updated);
  });
});

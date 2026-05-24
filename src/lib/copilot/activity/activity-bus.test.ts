import { beforeEach, describe, expect, it } from 'vitest';

import { ActivityBus, MAX_EVENTS_PER_USER } from './activity-bus';
import type { AIActivityEvent } from './types';

function mkEvent(overrides: Partial<AIActivityEvent> = {}): AIActivityEvent {
  return {
    id: 'evt-1',
    userId: 'user-1',
    timestamp: new Date('2026-05-24T00:00:00.000Z'),
    type: 'ask',
    operation: 'ask',
    latencyMs: 0,
    status: 'pending',
    ...overrides,
  };
}

describe('ActivityBus', () => {
  let bus: ActivityBus;
  beforeEach(() => {
    bus = new ActivityBus();
  });

  it('resolveCursor returns init mode + full set when no cursor supplied', () => {
    bus.append('user-1', mkEvent({ id: 'a' }));
    bus.append('user-1', mkEvent({ id: 'b' }));

    const result = bus.resolveCursor('user-1', null);
    expect(result.mode).toBe('init');
    expect(result.events.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('resolveCursor returns init mode when the cursor is unknown/evicted', () => {
    bus.append('user-1', mkEvent({ id: 'a' }));
    bus.append('user-1', mkEvent({ id: 'b' }));

    const result = bus.resolveCursor('user-1', 'ghost');
    expect(result.mode).toBe('init');
    expect(result.events.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('resolveCursor replay is INCLUSIVE so later in-place updates to the cursor event are delivered', () => {
    // Regression: previously slice(idx+1) skipped the cursor event itself,
    // meaning a PATCH that updated `b` while the client was disconnected
    // would be invisible on resume because the cursor pointed at `b`.
    bus.append('user-1', mkEvent({ id: 'a' }));
    bus.append('user-1', mkEvent({ id: 'b', status: 'pending' }));
    bus.update('user-1', mkEvent({ id: 'b', status: 'success' }));

    const result = bus.resolveCursor('user-1', 'b');
    expect(result.mode).toBe('replay');
    expect(result.events.map((e) => e.id)).toEqual(['b']);
    expect(result.events[0].status).toBe('success');
  });

  it('getById returns the latest retained version after update()', () => {
    bus.append('user-1', mkEvent({ id: 'a', status: 'pending' }));
    bus.update('user-1', mkEvent({ id: 'a', status: 'success' }));

    expect(bus.getById('user-1', 'a')?.status).toBe('success');
    expect(bus.getById('user-1', 'missing')).toBeUndefined();
    expect(bus.getById('other-user', 'a')).toBeUndefined();
  });

  it('append evicts the oldest event when the per-user cap is exceeded', () => {
    for (let i = 0; i < MAX_EVENTS_PER_USER + 5; i++) {
      bus.append('user-1', mkEvent({ id: `evt-${i}` }));
    }
    const snapshot = bus.snapshot('user-1');
    expect(snapshot).toHaveLength(MAX_EVENTS_PER_USER);
    expect(snapshot[0].id).toBe('evt-5');
    // Evicted entries are removed from the lookup index.
    expect(bus.getById('user-1', 'evt-0')).toBeUndefined();
    expect(bus.getById('user-1', 'evt-5')).toBeDefined();
  });

  it('clear() empties the ring AND broadcasts an init frame to subscribers', async () => {
    bus.append('user-1', mkEvent({ id: 'a' }));
    const { iterator } = bus.subscribe('user-1');

    bus.clear('user-1');

    const reader = iterator[Symbol.asyncIterator]();
    const next = await reader.next();
    expect(next.done).toBe(false);
    expect(next.value.type).toBe('init');
    if (next.value.type === 'init') {
      expect(next.value.events).toEqual([]);
      expect(next.value.cursor).toBeNull();
    }
    expect(bus.snapshot('user-1')).toEqual([]);
  });

  it('append broadcasts to live subscribers as `event` frames', async () => {
    const { iterator } = bus.subscribe('user-1');
    const reader = iterator[Symbol.asyncIterator]();

    bus.append('user-1', mkEvent({ id: 'a' }));

    const next = await reader.next();
    expect(next.done).toBe(false);
    if (next.value.type === 'event') {
      expect(next.value.event.id).toBe('a');
    } else {
      throw new Error(`expected event frame, got ${next.value.type}`);
    }
  });

  it('append is idempotent on duplicate ids (defends against hydration race)', () => {
    bus.append('user-1', mkEvent({ id: 'a', status: 'pending' }));
    // Second append with same id is ignored, leaving the first in place.
    bus.append('user-1', mkEvent({ id: 'a', status: 'success' }));
    const snapshot = bus.snapshot('user-1');
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].status).toBe('pending');
  });

  it('hydrate seeds events without broadcasting and skips ids already in the bus', async () => {
    bus.append('user-1', mkEvent({ id: 'live' }));
    const { iterator } = bus.subscribe('user-1');
    const reader = iterator[Symbol.asyncIterator]();

    bus.hydrate('user-1', [
      mkEvent({ id: 'live', status: 'success' }), // dup — must be skipped
      mkEvent({ id: 'persisted-1' }),
      mkEvent({ id: 'persisted-2' }),
    ]);

    const snapshot = bus.snapshot('user-1');
    expect(snapshot.map((e) => e.id)).toEqual(['live', 'persisted-1', 'persisted-2']);
    // The "live" version's status must NOT have been clobbered by the hydrate.
    expect(snapshot[0].status).toBe('pending');

    // Confirm no broadcast was issued by racing a fresh append.
    bus.append('user-1', mkEvent({ id: 'after-hydrate' }));
    const next = await reader.next();
    if (next.value.type === 'event') {
      expect(next.value.event.id).toBe('after-hydrate');
    } else {
      throw new Error('expected event frame');
    }
  });
});

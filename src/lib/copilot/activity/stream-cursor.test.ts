import { describe, expect, it } from 'vitest';

import {
  eventsAfterCursor,
  mergeActivityEventStreams,
} from './stream-cursor';
import type { AIActivityEvent } from './types';

function mkEvent(
  id: string,
  timestamp: string,
  overrides: Partial<AIActivityEvent> = {},
): AIActivityEvent {
  return {
    id,
    userId: 'user-1',
    timestamp: new Date(timestamp),
    type: 'ask',
    operation: 'ask',
    latencyMs: 0,
    status: 'success',
    ...overrides,
  };
}

describe('stream-cursor', () => {
  it('merges shadow and live events by id and keeps latest copy', () => {
    const shadow = [
      mkEvent('evt-1', '2026-05-24T00:00:01.000Z', { status: 'pending' }),
      mkEvent('evt-2', '2026-05-24T00:00:03.000Z'),
    ];
    const live = [
      mkEvent('evt-1', '2026-05-24T00:00:02.000Z', { status: 'success', latencyMs: 120 }),
      mkEvent('evt-3', '2026-05-24T00:00:04.000Z'),
    ];

    const merged = mergeActivityEventStreams(shadow, live);

    expect(merged.map((event) => event.id)).toEqual(['evt-1', 'evt-2', 'evt-3']);
    expect(merged[0].status).toBe('success');
    expect(merged[0].latencyMs).toBe(120);
  });

  it('returns all events after the cursor id', () => {
    const events = [
      mkEvent('evt-1', '2026-05-24T00:00:01.000Z'),
      mkEvent('evt-2', '2026-05-24T00:00:02.000Z'),
      mkEvent('evt-3', '2026-05-24T00:00:03.000Z'),
    ];

    const after = eventsAfterCursor(events, 'evt-1');

    expect(after.map((event) => event.id)).toEqual(['evt-2', 'evt-3']);
  });

  it('returns all events when cursor is unknown', () => {
    const events = [
      mkEvent('evt-1', '2026-05-24T00:00:01.000Z'),
      mkEvent('evt-2', '2026-05-24T00:00:02.000Z'),
    ];

    const after = eventsAfterCursor(events, 'evt-missing');

    expect(after.map((event) => event.id)).toEqual(['evt-1', 'evt-2']);
  });
});

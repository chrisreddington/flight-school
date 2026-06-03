import type { Message, ToolCallEvent } from '@/lib/threads';
import { describe, expect, it } from 'vitest';

import { finalizeToolEvents, upsertMessageById } from './thread-consolidation';

describe('finalizeToolEvents', () => {
  it('coerces a lingering running event to complete', () => {
    const events: ToolCallEvent[] = [{ id: 't-0', name: 'skill', status: 'running', args: { name: 'pdf' } }];

    const finalized = finalizeToolEvents(events);

    expect(finalized).toEqual([{ id: 't-0', name: 'skill', status: 'complete', args: { name: 'pdf' } }]);
  });

  it('preserves result and durationMs on already-complete events', () => {
    const events: ToolCallEvent[] = [
      { id: 't-0', name: 'search_code', status: 'complete', result: '42 matches', durationMs: 1200 },
    ];

    const finalized = finalizeToolEvents(events);

    expect(finalized).toEqual(events);
  });

  it('does not mutate the input array or its events', () => {
    const events: ToolCallEvent[] = [{ id: 't-0', name: 'skill', status: 'running' }];

    finalizeToolEvents(events);

    expect(events[0].status).toBe('running');
  });

  it('returns an empty array unchanged', () => {
    expect(finalizeToolEvents([])).toEqual([]);
  });
});

describe('upsertMessageById', () => {
  const baseMessage: Message = { id: 'm-1', role: 'assistant', content: 'hi', timestamp: '2026-01-01T00:00:00.000Z' };

  it('appends when the id is absent', () => {
    const result = upsertMessageById([], 'm-1', baseMessage, false);
    expect(result).toEqual([baseMessage]);
  });
});

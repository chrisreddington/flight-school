/**
 * useAIActivity — behaviour tests. `renderHook` + `result.current` assertions.
 * Mocks live at system seams only: `EventSource` and the global `fetch` stub.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIActivityEvent } from '@/lib/copilot/activity/types';
import { buildActivityStreamUrl, useAIActivity } from './use-ai-activity';

type MessageListener = (event: { data: string }) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: MessageListener | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }
  emit(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
  fail() {
    this.onerror?.();
  }
  static latest() {
    const inst = this.instances.at(-1);
    if (!inst) throw new Error('No EventSource instance created yet');
    return inst;
  }
}

const mockFetchOnce = (payload: unknown, ok = true) =>
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
  } as Response);

const sampleEvent = (overrides: Partial<AIActivityEvent> = {}): AIActivityEvent => ({
  id: 'e1',
  operation: 'embed',
  type: 'embed',
  status: 'success',
  latencyMs: 100,
  timestamp: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

const emitInit = (events: AIActivityEvent[]) =>
  MockEventSource.latest().emit({
    type: 'init',
    events: events.map((e) => ({ ...e, timestamp: e.timestamp.toISOString() })),
  });

function seed(events: AIActivityEvent[]) {
  const hook = renderHook(() => useAIActivity());
  act(() => emitInit(events));
  return hook;
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
});
afterEach(() => vi.unstubAllGlobals());

describe('buildActivityStreamUrl', () => {
  it.each([
    ['no cursor → bare URL', null, '/api/ai-activity/stream'],
    ['cursor appended', 'evt-123', '/api/ai-activity/stream?cursor=evt-123'],
    ['cursor encoded', 'a b/c', '/api/ai-activity/stream?cursor=a%20b%2Fc'],
  ])('%s', (_, cursor, expected) => {
    expect(buildActivityStreamUrl(cursor)).toBe(expected);
  });
});

describe('useAIActivity — SSE lifecycle', () => {
  it('opens an EventSource at the stream URL on mount', () => {
    renderHook(() => useAIActivity());
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.latest().url).toBe('/api/ai-activity/stream');
  });

  it('does not open a connection when disabled', () => {
    renderHook(() => useAIActivity({ enabled: false }));
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('closes the connection on unmount', () => {
    const { unmount } = renderHook(() => useAIActivity());
    const es = MockEventSource.latest();
    unmount();
    expect(es.close.mock.calls.length).toBeGreaterThan(0);
  });

  it('closes when paused and reopens when resumed', () => {
    const { result } = renderHook(() => useAIActivity());
    const first = MockEventSource.latest();
    act(() => result.current.setIsPaused(true));
    expect(result.current.isPaused).toBe(true);
    expect(first.close.mock.calls.length).toBeGreaterThan(0);
    act(() => result.current.setIsPaused(false));
    expect(MockEventSource.instances).toHaveLength(2);
    expect(result.current.isPaused).toBe(false);
  });

  it('reconnects with a cursor pointing at the most recent event id', () => {
    const { result } = renderHook(() => useAIActivity());
    act(() => emitInit([sampleEvent({ id: 'last' })]));
    act(() => result.current.setIsPaused(true));
    act(() => result.current.setIsPaused(false));
    expect(MockEventSource.latest().url).toBe('/api/ai-activity/stream?cursor=last');
  });
});

describe('useAIActivity — event stream handling', () => {
  it('replaces events on init and parses timestamps to Date', () => {
    const { result } = renderHook(() => useAIActivity());
    act(() => emitInit([sampleEvent({ id: 'a' }), sampleEvent({ id: 'b', type: 'ask', operation: 'ask' })]));
    expect(result.current.events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(result.current.events[0].timestamp).toBeInstanceOf(Date);
    expect(result.current.hasEvents).toBe(true);
  });

  it('appends new single events in arrival order', () => {
    const { result } = renderHook(() => useAIActivity());
    const es = MockEventSource.latest();
    const evt = (id: string, ts: string) => ({
      type: 'event',
      event: { ...sampleEvent({ id }), timestamp: ts },
    });
    act(() => es.emit(evt('first', '2024-01-01T00:00:00Z')));
    act(() => es.emit(evt('second', '2024-01-01T00:00:01Z')));
    expect(result.current.events.map((e) => e.id)).toEqual(['first', 'second']);
  });

  it('updates an existing event in place when the same id arrives again', () => {
    const { result } = renderHook(() => useAIActivity());
    const es = MockEventSource.latest();
    const emit = (overrides: Partial<AIActivityEvent>, ts: string) =>
      es.emit({
        type: 'event',
        event: { ...sampleEvent({ id: 'x', ...overrides }), timestamp: ts },
      });
    act(() => emit({ status: 'pending', latencyMs: 0 }, '2024-01-01T00:00:00Z'));
    act(() => emit({ status: 'success', latencyMs: 250 }, '2024-01-01T00:00:01Z'));
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]).toMatchObject({ id: 'x', status: 'success', latencyMs: 250 });
  });

  it('clears events when a synthetic id="clear" event arrives', () => {
    const { result } = renderHook(() => useAIActivity());
    act(() => emitInit([sampleEvent({ id: 'a' })]));
    act(() =>
      MockEventSource.latest().emit({
        type: 'event',
        event: {
          id: 'clear',
          operation: 'clear',
          type: 'internal',
          status: 'success',
          latencyMs: 0,
          timestamp: '2024-01-01T00:00:02Z',
        },
      }),
    );
    expect(result.current.events).toEqual([]);
    expect(result.current.hasEvents).toBe(false);
  });

  it('ignores malformed SSE payloads without throwing', () => {
    const { result } = renderHook(() => useAIActivity());
    act(() => MockEventSource.latest().emit('not-json'));
    expect(result.current.events).toEqual([]);
  });
});

describe('useAIActivity — fallback polling', () => {
  it('falls back to GET /api/ai-activity when SSE errors', async () => {
    mockFetchOnce({
      events: [{ ...sampleEvent({ id: 'p1' }), timestamp: '2024-01-01T00:00:00Z' }],
    });
    const { result } = renderHook(() => useAIActivity());
    act(() => MockEventSource.latest().fail());
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.events[0].id).toBe('p1');
    expect(result.current.events[0].timestamp).toBeInstanceOf(Date);
  });
});

describe('useAIActivity — clear()', () => {
  it('empties the events list after DELETE resolves', async () => {
    const { result } = seed([sampleEvent({ id: 'a' })]);
    expect(result.current.events).toHaveLength(1);
    mockFetchOnce({});
    await act(async () => {
      await result.current.clear();
    });
    expect(result.current.events).toEqual([]);
    expect(result.current.hasEvents).toBe(false);
  });

  it('swallows DELETE failures', async () => {
    const { result } = renderHook(() => useAIActivity());
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'));
    await expect(act(async () => result.current.clear())).resolves.not.toThrow();
  });
});

describe('useAIActivity — derived state', () => {
  it('returns an empty-state stats object before any events arrive', () => {
    const { result } = renderHook(() => useAIActivity());
    expect(result.current.stats).toEqual({
      total: 0,
      avgLatency: 0,
      totalTokens: 0,
      byType: { embed: 0, ask: 0, session: 0, tool: 0, error: 0, internal: 0 },
    });
    expect(result.current.hasEvents).toBe(false);
    expect(result.current.pendingCount).toBe(0);
  });

  it('aggregates stats (avgLatency rounded, totalTokens, byType)', () => {
    const { result } = seed([
      sampleEvent({
        id: '1',
        type: 'embed',
        latencyMs: 100,
        output: { tokens: { input: 10, output: 20 } },
      }),
      sampleEvent({
        id: '2',
        type: 'ask',
        operation: 'ask',
        latencyMs: 200,
        output: { tokens: { input: 30, output: 40 } },
      }),
      sampleEvent({ id: '3', type: 'embed', latencyMs: 150 }),
    ]);
    expect(result.current.stats).toEqual({
      total: 3,
      avgLatency: 150,
      totalTokens: 100,
      byType: { embed: 2, ask: 1, session: 0, tool: 0, error: 0, internal: 0 },
    });
  });

  it.each<AIActivityEvent['type']>(['embed', 'ask', 'session', 'tool', 'error', 'internal'])(
    'counts %s events in byType',
    (type) => {
      const { result } = seed([sampleEvent({ id: type, type })]);
      expect(result.current.stats.byType[type]).toBe(1);
    },
  );

  it('counts events whose status is pending', () => {
    const { result } = seed([
      sampleEvent({ id: '1', status: 'pending', latencyMs: 0 }),
      sampleEvent({ id: '2', status: 'success' }),
      sampleEvent({ id: '3', status: 'pending', latencyMs: 0 }),
    ]);
    expect(result.current.pendingCount).toBe(2);
  });
});

describe('useAIActivity — exportJSON', () => {
  it('returns "[]" when there are no events', () => {
    const { result } = renderHook(() => useAIActivity());
    expect(result.current.exportJSON()).toBe('[]');
  });

  it('serialises events as pretty-printed JSON', () => {
    const { result } = seed([sampleEvent({ id: 'e1', latencyMs: 100 })]);
    const json = result.current.exportJSON();
    expect(JSON.parse(json)).toMatchObject([{ id: 'e1', operation: 'embed', latencyMs: 100 }]);
    expect(json).toContain('\n  ');
  });
});

describe('useAIActivity — exportMarkdown', () => {
  it('returns the empty-state heading when there are no events', () => {
    const { result } = renderHook(() => useAIActivity());
    expect(result.current.exportMarkdown()).toBe('# AI Activity Log\n\nNo events recorded.');
  });

  it('renders header, time, latency and status for each event', () => {
    const { result } = seed([sampleEvent({ id: 'e1', operation: 'embed-text', latencyMs: 100, status: 'success' })]);
    const md = result.current.exportMarkdown();
    expect(md).toContain('# AI Activity Log');
    expect(md).toContain('## embed-text (embed)');
    expect(md).toContain('**Time**: 2024-01-01T00:00:00.000Z');
    expect(md).toContain('**Latency**: 100ms');
    expect(md).toContain('**Status**: success');
  });

  it.each<[string, Partial<AIActivityEvent>, string]>([
    ['prompt', { input: { prompt: 'hello?' } }, '**Prompt**: hello?'],
    ['text', { input: { text: 'embed me' } }, '**Text**: embed me'],
    ['tokens', { output: { tokens: { input: 50, output: 100 } } }, '**Tokens**: 50 in / 100 out'],
    ['error', { status: 'error', error: 'boom' }, '**Error**: boom'],
  ])('includes %s when present', (_, overrides, expected) => {
    const { result } = seed([sampleEvent({ id: 'e1', ...overrides })]);
    expect(result.current.exportMarkdown()).toContain(expected);
  });

  it.each<['Prompt' | 'Text', Partial<AIActivityEvent>]>([
    ['Prompt', { input: { prompt: 'a'.repeat(250) } }],
    ['Text', { input: { text: 'a'.repeat(250) } }],
  ])('truncates %s longer than 200 chars with an ellipsis', (label, overrides) => {
    const { result } = seed([sampleEvent({ id: 'e1', ...overrides })]);
    const md = result.current.exportMarkdown();
    expect(md).toContain(`**${label}**: ${'a'.repeat(200)}...`);
    expect(md).not.toContain('a'.repeat(201));
  });
});

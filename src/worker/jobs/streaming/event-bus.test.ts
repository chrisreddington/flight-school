import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  jobEventBus,
  JobEventBus,
  MAX_BYTES_PER_JOB,
  MAX_EVENT_BYTES,
  MAX_EVENTS_PER_JOB,
  TERMINAL_RETENTION_MS,
} from './event-bus';

beforeEach(() => {
  jobEventBus.__resetForTests();
});
afterEach(() => {
  jobEventBus.__resetForTests();
});

describe('JobEventBus.append', () => {
  it('assigns monotonic per-job sequence numbers', () => {
    const a = jobEventBus.append('j1', { type: 'delta', content: 'a' });
    const b = jobEventBus.append('j1', { type: 'delta', content: 'b' });
    const c = jobEventBus.append('j2', { type: 'delta', content: 'c' });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(c.seq).toBe(1);
  });

  it('does NOT coalesce consecutive deltas (replay must preserve fragments)', () => {
    // Coalescing was intentionally removed: deltas are append-only
    // fragments from the consumer's perspective. Coalescing would cause
    // duplicate content on reconnect-from-cursor (cumulative content
    // applied on top of the partial string the client already has).
    jobEventBus.append('j1', { type: 'delta', content: 'hello ' });
    jobEventBus.append('j1', { type: 'delta', content: 'world' });
    const replay = jobEventBus.replay('j1');
    expect(replay).toHaveLength(2);
    expect(replay[0].seq).toBe(1);
    expect((replay[0].event as { content: string }).content).toBe('hello ');
    expect(replay[1].seq).toBe(2);
    expect((replay[1].event as { content: string }).content).toBe('world');
  });

  it('replay-from-cursor returns only the unseen fragment (no duplicate "hello ")', () => {
    // Regression: a client that already received seq=1 ("hello ") must
    // see ONLY "world" when reconnecting with cursor=1 — not "hello world".
    jobEventBus.append('j1', { type: 'delta', content: 'hello ' });
    jobEventBus.append('j1', { type: 'delta', content: 'world' });
    const replay = jobEventBus.replay('j1', 1);
    expect(replay).toHaveLength(1);
    expect(replay[0].seq).toBe(2);
    expect((replay[0].event as { content: string }).content).toBe('world');
  });

  it('does not coalesce across non-delta events', () => {
    jobEventBus.append('j1', { type: 'delta', content: 'a' });
    jobEventBus.append('j1', {
      type: 'tool_start',
      toolCallId: 't1',
      name: 'foo',
      args: {},
    });
    jobEventBus.append('j1', { type: 'delta', content: 'b' });
    expect(jobEventBus.replay('j1')).toHaveLength(3);
  });

  it('retains rolling state_snapshot separately from the ring buffer', () => {
    jobEventBus.snapshot('j1', { content: 'partial', toolEvents: [], hasActionableItem: false });
    jobEventBus.append('j1', { type: 'delta', content: 'more' });
    const replay = jobEventBus.replay('j1', 0);
    expect(replay[0].event.type).toBe('state_snapshot');
    expect(replay[1].event.type).toBe('delta');
  });

  it('truncates oversize delta content before notify and persists the truncated event', () => {
    const big = 'x'.repeat(MAX_EVENT_BYTES + 100);
    const sequenced = jobEventBus.append('j1', { type: 'delta', content: big });
    expect(sequenced.byteSize).toBeLessThanOrEqual(MAX_EVENT_BYTES);
    const replay = jobEventBus.replay('j1');
    expect(replay).toHaveLength(1);
    const content = (replay[0].event as { content: string }).content;
    expect(content.endsWith('[truncated]')).toBe(true);
  });

  it('truncates oversize state_snapshot content and tool results', () => {
    const big = 'x'.repeat(MAX_EVENT_BYTES + 100);
    const fatTool = {
      toolCallId: 't1',
      id: 't1',
      name: 'fatTool',
      args: {},
      status: 'completed' as const,
      result: 'y'.repeat(8_000),
    };
    jobEventBus.snapshot('j1', { content: big, toolEvents: [fatTool], hasActionableItem: false });
    const replay = jobEventBus.replay('j1', 0);
    expect(replay).toHaveLength(1);
    const evt = replay[0].event as { content: string; toolEvents: Array<{ result: unknown }> };
    expect(evt.content.length).toBeLessThan(MAX_EVENT_BYTES);
    expect(typeof evt.toolEvents[0].result).toBe('string');
    expect(String(evt.toolEvents[0].result)).toMatch(/^\[truncated:/);
  });

  it('marks the buffer terminated on done/cancelled/failed', () => {
    jobEventBus.append('j1', {
      type: 'done',
      content: 'x',
      toolEvents: [],
      hasActionableItem: false,
    });
    expect(jobEventBus.isTerminated('j1')).toBe(true);
  });
});

describe('JobEventBus.replay', () => {
  it('returns the snapshot followed by post-snapshot events on full replay', () => {
    jobEventBus.append('j1', { type: 'delta', content: 'pre' });
    jobEventBus.snapshot('j1', { content: 'pre', toolEvents: [], hasActionableItem: false });
    jobEventBus.append('j1', { type: 'delta', content: 'post' });
    const replay = jobEventBus.replay('j1', 0);
    expect(replay.map((e) => e.event.type)).toEqual(['state_snapshot', 'delta']);
  });

  it('returns only events strictly after the cursor when afterSeq > 0', () => {
    jobEventBus.append('j1', { type: 'delta', content: 'a' });
    jobEventBus.append('j1', {
      type: 'tool_start',
      toolCallId: 't1',
      name: 'foo',
      args: {},
    });
    jobEventBus.append('j1', { type: 'delta', content: 'b' });
    const after2 = jobEventBus.replay('j1', 2);
    expect(after2.map((e) => e.seq)).toEqual([3]);
  });

  it('returns [] for unknown jobs', () => {
    expect(jobEventBus.replay('does-not-exist')).toEqual([]);
  });

  it('prepends snapshot when cursor has fallen behind the retained buffer', () => {
    // Take a small dedicated bus so we can blow through the cap deterministically.
    const bus = new JobEventBus();
    bus.snapshot('j1', { content: 'baseline', toolEvents: [], hasActionableItem: false });
    // Push enough events to evict the very first ones from the ring buffer.
    const chunk = 'y'.repeat(1024);
    for (let i = 0; i < 2000; i++) {
      bus.append('j1', {
        type: 'tool_start',
        toolCallId: `t${i}`,
        name: 'noop',
        args: { padding: chunk },
      });
    }
    // A client with cursor=2 (far behind the retained window) should now
    // receive the snapshot first so it can rebuild baseline state.
    const replay = bus.replay('j1', 2);
    expect(replay[0]?.event.type).toBe('state_snapshot');
    // And the rest are the surviving tail events.
    expect(replay.slice(1).every((e) => e.seq > 2)).toBe(true);
  });

  it('does not prepend snapshot when cursor is within the retained window', () => {
    jobEventBus.snapshot('j1', { content: 'baseline', toolEvents: [], hasActionableItem: false });
    jobEventBus.append('j1', { type: 'delta', content: 'a' });
    jobEventBus.append('j1', { type: 'delta', content: 'b' });
    // Cursor=2 sits inside the buffer; no snapshot replay needed.
    const replay = jobEventBus.replay('j1', 2);
    expect(replay.every((e) => e.event.type !== 'state_snapshot')).toBe(true);
  });
});

describe('JobEventBus.subscribe', () => {
  it('delivers live events to subscribers', async () => {
    const sub = jobEventBus.subscribe('j1');
    const collected: number[] = [];
    const pump = (async () => {
      for await (const evt of sub.iterator) {
        collected.push(evt.seq);
        if (collected.length >= 2) break;
      }
    })();
    jobEventBus.append('j1', { type: 'delta', content: 'a' });
    jobEventBus.append('j1', { type: 'delta', content: 'b' });
    await pump;
    expect(collected).toEqual([1, 2]);
  });

  it('queues events that arrive before the first next() call', async () => {
    const sub = jobEventBus.subscribe('j1');
    jobEventBus.append('j1', { type: 'delta', content: 'a' });
    jobEventBus.append('j1', { type: 'delta', content: 'b' });
    const collected: number[] = [];
    for await (const evt of sub.iterator) {
      collected.push(evt.seq);
      if (collected.length >= 2) {
        sub.unsubscribe();
        break;
      }
    }
    expect(collected).toEqual([1, 2]);
  });

  it('closes cleanly on unsubscribe', async () => {
    const sub = jobEventBus.subscribe('j1');
    sub.unsubscribe();
    const iter = sub.iterator[Symbol.asyncIterator]();
    const result = await iter.next();
    expect(result.done).toBe(true);
  });
});

describe('JobEventBus.sweep', () => {
  it('removes terminated jobs after retention window with no subscribers', () => {
    jobEventBus.append('j1', {
      type: 'done',
      content: '',
      toolEvents: [],
      hasActionableItem: false,
    });
    const removed = jobEventBus.sweep(Date.now() + TERMINAL_RETENTION_MS + 1000);
    expect(removed).toBe(1);
    expect(jobEventBus.isTerminated('j1')).toBe(false);
  });

  it('does not remove jobs that still have subscribers', () => {
    jobEventBus.append('j1', {
      type: 'done',
      content: '',
      toolEvents: [],
      hasActionableItem: false,
    });
    const sub = jobEventBus.subscribe('j1');
    const removed = jobEventBus.sweep(Date.now() + TERMINAL_RETENTION_MS + 1000);
    expect(removed).toBe(0);
    sub.unsubscribe();
  });
});

describe('JobEventBus cap enforcement', () => {
  it('every event variant respects MAX_EVENT_BYTES after sanitize, including the variants without dedicated arms', () => {
    // Regression: previously `tool_start`, `done`, `cancelled` were not
    // routed through the type-specific sanitizer and could exceed the
    // 64 KiB cap. `clampToCap` now enforces the invariant globally.
    const huge = 'z'.repeat(MAX_EVENT_BYTES * 2);
    const a = jobEventBus.append('j1', {
      type: 'tool_start',
      toolCallId: 't1',
      name: 'fat',
      args: { padding: huge },
    });
    const b = jobEventBus.append('j1', {
      type: 'done',
      content: huge,
      toolEvents: [],
      hasActionableItem: false,
    });
    const c = jobEventBus.append('j1', {
      type: 'cancelled',
      content: huge,
      toolEvents: [],
    });
    expect(a.byteSize).toBeLessThanOrEqual(MAX_EVENT_BYTES);
    expect(b.byteSize).toBeLessThanOrEqual(MAX_EVENT_BYTES);
    expect(c.byteSize).toBeLessThanOrEqual(MAX_EVENT_BYTES);
    // Discriminator preserved across the fallback.
    expect(a.event.type).toBe('tool_start');
    expect(b.event.type).toBe('done');
    expect(c.event.type).toBe('cancelled');
  });

  it('caps total bytes per job', () => {
    const bus = new JobEventBus();
    // Use 1 KiB strings so we don't trip MAX_EVENT_BYTES.
    const chunk = 'y'.repeat(1024);
    for (let i = 0; i < 2000; i++) {
      bus.append('j1', {
        type: 'tool_start',
        toolCallId: `t${i}`,
        name: 'noop',
        args: { padding: chunk },
      });
    }
    const replay = bus.replay('j1');
    // The cap should have evicted older events. We expect significantly
    // fewer than 2000 events remaining (or total bytes <= cap).
    const totalBytes = replay.reduce((acc, e) => acc + e.byteSize, 0);
    expect(totalBytes).toBeLessThanOrEqual(MAX_BYTES_PER_JOB);
    expect(replay.length).toBeLessThanOrEqual(MAX_EVENTS_PER_JOB);
  });
});

describe('JobEventBus.appendTerminalIfNotTerminated', () => {
  it('writes the terminal frame on a fresh buffer', () => {
    const bus = new JobEventBus();
    const result = bus.appendTerminalIfNotTerminated('j1', {
      type: 'done',
      content: 'final',
      toolEvents: [],
      hasActionableItem: false,
    });
    expect(result).not.toBeNull();
    expect(bus.isTerminated('j1')).toBe(true);
  });

  it('is a no-op on a buffer that already terminated', () => {
    const bus = new JobEventBus();
    bus.append('j1', { type: 'cancelled', content: '', toolEvents: [] });
    expect(bus.isTerminated('j1')).toBe(true);
    const result = bus.appendTerminalIfNotTerminated('j1', {
      type: 'done',
      content: 'should-be-dropped',
      toolEvents: [],
      hasActionableItem: false,
    });
    expect(result).toBeNull();
    const replay = bus.replay('j1');
    expect(replay.some((e) => e.event.type === 'done')).toBe(false);
  });

  it('throws when called with a non-terminal event', () => {
    const bus = new JobEventBus();
    expect(() =>
      bus.appendTerminalIfNotTerminated('j1', { type: 'delta', content: 'x' }),
    ).toThrow();
  });

  it('emits a single terminal frame under concurrent calls', () => {
    const bus = new JobEventBus();
    const a = bus.appendTerminalIfNotTerminated('j1', {
      type: 'done',
      content: 'a',
      toolEvents: [],
      hasActionableItem: false,
    });
    const b = bus.appendTerminalIfNotTerminated('j1', {
      type: 'cancelled',
      content: 'b',
      toolEvents: [],
    });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    const replay = bus.replay('j1');
    const terminals = replay.filter((e) =>
      ['done', 'cancelled', 'failed'].includes(e.event.type),
    );
    expect(terminals).toHaveLength(1);
  });
});

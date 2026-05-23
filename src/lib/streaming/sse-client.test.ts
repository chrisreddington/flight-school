import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { consumeSSE, SSEReconnectExhaustedError } from './sse-client';

interface ScriptedResponse {
  /** Frames in raw SSE wire format (already include the trailing `\n\n`). */
  chunks: string[];
  /** When set, throw instead of completing the stream. */
  throwAfterChunks?: Error;
  /** Override HTTP status. */
  status?: number;
  /** Override content-type. */
  contentType?: string | null;
}

interface FakeFetchHandle {
  fetchImpl: typeof fetch;
  /** Total number of times the fetch impl has been invoked. */
  callCount: () => number;
  /** URLs passed on each successive call. */
  calls: string[];
  /** Provide the response for the next call. */
  enqueue: (resp: ScriptedResponse) => void;
  /** Programmatic enqueue helper for a successful single-chunk response. */
  enqueueOk: (sse: string) => void;
  /** Programmatic enqueue helper for a transient network error. */
  enqueueError: (err?: Error) => void;
}

function createFakeFetch(): FakeFetchHandle {
  const queue: ScriptedResponse[] = [];
  const calls: string[] = [];

  const fetchImpl: typeof fetch = async (input) => {
    calls.push(typeof input === 'string' ? input : (input as Request).url);
    const next = queue.shift();
    if (!next) {
      throw new Error('FakeFetch: no scripted response queued');
    }

    if (next.throwAfterChunks && next.chunks.length === 0) {
      throw next.throwAfterChunks;
    }

    const status = next.status ?? 200;
    const contentType = next.contentType === undefined ? 'text/event-stream' : next.contentType;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of next.chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        if (next.throwAfterChunks) {
          controller.error(next.throwAfterChunks);
          return;
        }
        controller.close();
      },
      cancel() {
        // No-op; some flows abort the controller mid-stream.
      },
    });

    return new Response(stream, {
      status,
      headers: contentType ? { 'content-type': contentType } : {},
    });
  };

  return {
    fetchImpl,
    callCount: () => calls.length,
    calls,
    enqueue: (resp) => queue.push(resp),
    enqueueOk: (sse) => queue.push({ chunks: [sse] }),
    enqueueError: (err) =>
      queue.push({ chunks: [], throwAfterChunks: err ?? new Error('network failure') }),
  };
}

describe('consumeSSE', () => {
  let fake: FakeFetchHandle;

  beforeEach(() => {
    fake = createFakeFetch();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits parsed events for a simple single-event stream', async () => {
    fake.enqueueOk('data: hello\n\n');

    const events: { id?: string; data: string }[] = [];
    const controller = new AbortController();

    await consumeSSE({
      buildUrl: () => '/api/test',
      signal: controller.signal,
      fetchImpl: fake.fetchImpl,
      onMessage: (evt) => {
        events.push({ id: evt.id, data: evt.data });
        return { terminal: true };
      },
    });

    expect(events).toEqual([{ id: undefined, data: 'hello' }]);
    expect(fake.callCount()).toBe(1);
  });

  it('threads the id field through to onMessage', async () => {
    fake.enqueueOk('id: 7\ndata: {"type":"delta","content":"hi"}\n\n');

    const seen: { id?: string }[] = [];
    await consumeSSE({
      buildUrl: () => '/api/test',
      signal: new AbortController().signal,
      fetchImpl: fake.fetchImpl,
      onMessage: (evt) => {
        seen.push({ id: evt.id });
        return { terminal: true };
      },
    });

    expect(seen).toEqual([{ id: '7' }]);
  });

  it('handles multi-line data fields per the SSE spec', async () => {
    // Two `data:` lines on one event should be joined with `\n`.
    fake.enqueueOk('data: line1\ndata: line2\n\n');

    const events: string[] = [];
    await consumeSSE({
      buildUrl: () => '/api/test',
      signal: new AbortController().signal,
      fetchImpl: fake.fetchImpl,
      onMessage: (evt) => {
        events.push(evt.data);
        return { terminal: true };
      },
    });

    expect(events).toEqual(['line1\nline2']);
  });

  it('handles CRLF line terminators', async () => {
    fake.enqueueOk('data: hello\r\n\r\n');

    const events: string[] = [];
    await consumeSSE({
      buildUrl: () => '/api/test',
      signal: new AbortController().signal,
      fetchImpl: fake.fetchImpl,
      onMessage: (evt) => {
        events.push(evt.data);
        return { terminal: true };
      },
    });

    expect(events).toEqual(['hello']);
  });

  it('ignores comment lines (heartbeats)', async () => {
    fake.enqueueOk(': keep-alive\n\ndata: real\n\n');

    const events: string[] = [];
    await consumeSSE({
      buildUrl: () => '/api/test',
      signal: new AbortController().signal,
      fetchImpl: fake.fetchImpl,
      onMessage: (evt) => {
        events.push(evt.data);
        return { terminal: true };
      },
    });

    expect(events).toEqual(['real']);
  });

  it('handles multi-byte UTF-8 split across chunk boundaries', async () => {
    // The codepoint U+1F600 (😀) is 4 bytes: F0 9F 98 80.
    // Split it across two chunks so the decoder must handle the boundary.
    const encoder = new TextEncoder();
    const fullFrame = 'data: hi 😀\n\n';
    const bytes = encoder.encode(fullFrame);
    // Find the smiley's first byte position.
    const splitIdx = bytes.indexOf(0xf0);
    const chunkA = bytes.slice(0, splitIdx + 2);
    const chunkB = bytes.slice(splitIdx + 2);
    const td = new TextDecoder('utf-8');

    fake.enqueue({
      chunks: [td.decode(chunkA, { stream: true }), td.decode(chunkB)],
    });

    // The fake-fetch wrapper re-encodes whatever string we give it, so to
    // really test boundary handling we use a custom ReadableStream below
    // by enqueuing pre-encoded chunks via the public helper.
    const events: string[] = [];

    // Use the raw bytes via a custom fetch impl.
    const customFetch: typeof fetch = async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunkA);
          controller.enqueue(chunkB);
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };

    await consumeSSE({
      buildUrl: () => '/api/test',
      signal: new AbortController().signal,
      fetchImpl: customFetch,
      onMessage: (evt) => {
        events.push(evt.data);
        return { terminal: true };
      },
    });

    expect(events).toEqual(['hi 😀']);
  });

  it('rejects with SSEReconnectExhaustedError on non-2xx response after backoff cap', async () => {
    vi.useFakeTimers();

    // 500 response → reconnect → 500 → … until budget exhausted.
    // Set the wall-clock budget to something tiny.
    for (let i = 0; i < 5; i += 1) {
      fake.enqueue({ chunks: [], status: 500 });
    }

    let nowValue = 0;
    const advance = (ms: number) => {
      nowValue += ms;
    };

    const reconnectAttempts: number[] = [];
    const promise = consumeSSE({
      buildUrl: () => '/api/test',
      signal: new AbortController().signal,
      fetchImpl: fake.fetchImpl,
      onMessage: () => {
        /* unreachable */
      },
      maxReconnectDurationMs: 1_000,
      setTimeoutImpl: (cb, ms) => {
        advance(ms);
        return globalThis.setTimeout(cb, 0);
      },
      clearTimeoutImpl: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
      nowMs: () => nowValue,
      random: () => 0,
      onReconnectScheduled: (attempt) => reconnectAttempts.push(attempt),
    });
    // Attach the rejection handler before running timers so the
    // unhandled-rejection tracker never sees it.
    const assertion = expect(promise).rejects.toBeInstanceOf(
      SSEReconnectExhaustedError,
    );

    // Drain pending microtasks + timers.
    await vi.runAllTimersAsync();
    await assertion;
    expect(reconnectAttempts.length).toBeGreaterThan(0);
  });

  it('reconnects after a transient network failure and re-reads the URL via buildUrl', async () => {
    vi.useFakeTimers();
    fake.enqueueError(new Error('boom'));
    fake.enqueueOk('data: recovered\n\n');

    let cursor = 0;
    let recoveredCalledBeforeFirstEvent = false;
    const events: string[] = [];
    let firstEventSeen = false;

    const promise = consumeSSE({
      buildUrl: () => `/api/test?cursor=${cursor}`,
      signal: new AbortController().signal,
      fetchImpl: fake.fetchImpl,
      onMessage: (evt) => {
        firstEventSeen = true;
        events.push(evt.data);
        return { terminal: true };
      },
      onReconnectRecovered: () => {
        // Recovery fires immediately before the first parsed frame is
        // delivered to onMessage (we know the parse succeeded — parser
        // only invokes onEvent after a complete event boundary).
        recoveredCalledBeforeFirstEvent = !firstEventSeen;
      },
      setTimeoutImpl: (cb) => globalThis.setTimeout(cb, 0),
      clearTimeoutImpl: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
      nowMs: () => 0, // never exhaust the budget
      random: () => 0,
    });

    // Bump the cursor before the reconnect happens, then drain.
    cursor = 42;
    await vi.runAllTimersAsync();
    await promise;

    expect(events).toEqual(['recovered']);
    expect(fake.calls).toEqual(['/api/test?cursor=0', '/api/test?cursor=42']);
    expect(recoveredCalledBeforeFirstEvent).toBe(true);
  });

  it('reconnects after the upstream closes the body without a terminal frame', async () => {
    // Stream emits a non-terminal event then EOFs cleanly (e.g. reverse-
    // proxy idle timeout, load-balancer half-close). `EventSource` would
    // auto-reconnect in this case; our client must do the same.
    vi.useFakeTimers();
    fake.enqueueOk('data: first\n\n');
    fake.enqueueOk('data: second\n\n');

    let cursor = 0;
    const events: string[] = [];

    const promise = consumeSSE({
      buildUrl: () => `/api/test?cursor=${cursor}`,
      signal: new AbortController().signal,
      fetchImpl: fake.fetchImpl,
      onMessage: (evt) => {
        events.push(evt.data);
        if (evt.data === 'second') return { terminal: true };
      },
      setTimeoutImpl: (cb) => globalThis.setTimeout(cb, 0),
      clearTimeoutImpl: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
      nowMs: () => 0,
      random: () => 0,
    });

    cursor = 7;
    await vi.runAllTimersAsync();
    await promise;

    expect(events).toEqual(['first', 'second']);
    expect(fake.calls).toEqual(['/api/test?cursor=0', '/api/test?cursor=7']);
  });

  it('does not reconnect after onMessage signals terminal', async () => {
    // Stream sends two events, both would normally close cleanly.
    // We mark the first as terminal — second must never be consumed.
    fake.enqueueOk('data: first\n\ndata: second\n\n');

    const events: string[] = [];
    await consumeSSE({
      buildUrl: () => '/api/test',
      signal: new AbortController().signal,
      fetchImpl: fake.fetchImpl,
      onMessage: (evt) => {
        events.push(evt.data);
        return { terminal: true };
      },
    });

    expect(events).toEqual(['first']);
    expect(fake.callCount()).toBe(1);
  });

  it('exits silently when the caller aborts mid-stream', async () => {
    const controller = new AbortController();
    // Single response that will be aborted; FakeFetch's stream resolves
    // immediately so we need to abort before runOneConnection awaits.
    fake.enqueueOk('data: hello\n\n');

    controller.abort();
    await expect(
      consumeSSE({
        buildUrl: () => '/api/test',
        signal: controller.signal,
        fetchImpl: fake.fetchImpl,
        onMessage: () => {
          /* unreachable */
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('exits silently when abort fires during the reconnect backoff', async () => {
    vi.useFakeTimers();
    fake.enqueueError(new Error('boom'));

    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const promise = consumeSSE({
      buildUrl: () => '/api/test',
      signal: controller.signal,
      fetchImpl: fake.fetchImpl,
      onMessage: () => {
        /* unreachable */
      },
      setTimeoutImpl: (cb, ms) => {
        timeoutHandle = globalThis.setTimeout(cb, ms);
        return timeoutHandle;
      },
      clearTimeoutImpl: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
      nowMs: () => 0,
      random: () => 0,
    });

    // Wait for the first connection to fail and the backoff timer to be
    // armed.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    vi.runAllTimers();
    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects with an Error (not retryable) when content-type is wrong', async () => {
    vi.useFakeTimers();
    // First response: wrong content-type → triggers reconnect path.
    // Second: also wrong → eventually exhausts budget.
    fake.enqueue({ chunks: ['data: x\n\n'], contentType: 'text/html' });

    const promise = consumeSSE({
      buildUrl: () => '/api/test',
      signal: new AbortController().signal,
      fetchImpl: fake.fetchImpl,
      onMessage: () => {
        /* unreachable */
      },
      maxReconnectDurationMs: 0,
      setTimeoutImpl: (cb) => globalThis.setTimeout(cb, 0),
      clearTimeoutImpl: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
      nowMs: () => 1, // already past budget after first failure
      random: () => 0,
    });
    const assertion = expect(promise).rejects.toBeInstanceOf(
      SSEReconnectExhaustedError,
    );

    await vi.runAllTimersAsync();
    await assertion;
  });
});

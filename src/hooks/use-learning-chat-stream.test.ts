import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveOperation } from '@/lib/operations/types';
import type { Thread } from '@/lib/threads';
import {
  combineStreamingThreadIds,
  finalizeInterruptedMessage,
  getStreamingContent,
  isThreadStreaming,
  useLearningChatStream,
} from './use-learning-chat-stream';

vi.mock('@/lib/utils/id-generator', () => ({
  generateMessageId: vi.fn(() => 'msg-finalized'),
}));

vi.mock('@/lib/utils/date-utils', () => ({
  now: vi.fn(() => '2026-01-01T00:00:00.000Z'),
}));

// --- Mocks for the renderHook integration tests below ---
const operationsState = vi.hoisted(() => {
  type Listener = () => void;
  type Snap = {
    topicRegenerations: Map<string, unknown>;
    challengeRegenerations: Map<string, unknown>;
    goalRegenerations: Map<string, unknown>;
    chatMessages: Map<string, unknown>;
  };
  const holder: { snapshot: Snap } = {
    snapshot: {
      topicRegenerations: new Map(),
      challengeRegenerations: new Map(),
      goalRegenerations: new Map(),
      chatMessages: new Map(),
    },
  };
  const listeners: Set<Listener> = new Set();
  return {
    holder,
    listeners,
    initializeMock: { calls: 0 },
    completeMock: { calls: [] as string[] },
    setChatMessages(map: Map<string, unknown>) {
      // useSyncExternalStore compares snapshots by reference — always swap.
      holder.snapshot = { ...holder.snapshot, chatMessages: map };
    },
    reset() {
      holder.snapshot = {
        topicRegenerations: new Map(),
        challengeRegenerations: new Map(),
        goalRegenerations: new Map(),
        chatMessages: new Map(),
      };
      listeners.clear();
      this.initializeMock.calls = 0;
      this.completeMock.calls = [];
    },
    notify() {
      for (const l of [...listeners]) l();
    },
  };
});

vi.mock('@/lib/operations', () => {
  const operationsManager = {
    initialize: vi.fn(async () => {
      operationsState.initializeMock.calls += 1;
    }),
    subscribe: (listener: () => void) => {
      operationsState.listeners.add(listener);
      return () => {
        operationsState.listeners.delete(listener);
      };
    },
    getSnapshot: () => operationsState.holder.snapshot,
    completeExistingJob: vi.fn((jobId: string) => {
      operationsState.completeMock.calls.push(jobId);
      const next = new Map(operationsState.holder.snapshot.chatMessages);
      next.delete(jobId);
      operationsState.setChatMessages(next);
    }),
  };
  return { operationsManager };
});

const cursorState = vi.hoisted(() => ({
  get: 0,
  setCalls: [] as Array<{ jobId: string; cursor: number }>,
  evictCalls: [] as string[],
}));

vi.mock('@/lib/streaming/cursor-store', () => ({
  getCursor: vi.fn(() => cursorState.get),
  setCursor: vi.fn((jobId: string, cursor: number) => {
    cursorState.setCalls.push({ jobId, cursor });
  }),
  evictCursor: vi.fn((jobId: string) => {
    cursorState.evictCalls.push(jobId);
  }),
}));

const threadStoreState = vi.hoisted(() => ({
  updateCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/threads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/threads')>();
  return {
    ...actual,
    threadStore: {
      update: vi.fn(async (thread: Record<string, unknown>) => {
        threadStoreState.updateCalls.push(thread);
      }),
      getById: vi.fn(async () => null),
    },
  };
});

// --- Test-controlled EventSource registry ---
interface FakeEventSource {
  url: string;
  closed: boolean;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: (() => void) | null;
  close: () => void;
}

const eventSources: FakeEventSource[] = [];
class FakeES implements FakeEventSource {
  url: string;
  closed = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    eventSources.push(this);
  }
  close() {
    this.closed = true;
  }
}

function createThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    title: 'Thread',
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isStreaming: false,
    ...overrides,
  };
}

describe('learning chat stream helpers', () => {
  it('should combine storage-backed streaming IDs with pending stream IDs', () => {
    const combined = combineStreamingThreadIds(
      ['thread-1', 'thread-2'],
      new Map([['thread-2', 'user-message-2'], ['thread-3', 'user-message-3']]),
    );

    expect(combined).toEqual(['thread-1', 'thread-2', 'thread-3']);
  });

  it('should treat the active thread as streaming when either storage or pending state says it is', () => {
    expect(isThreadStreaming(createThread({ isStreaming: true }), 'thread-1', new Map())).toBe(true);
    expect(isThreadStreaming(createThread(), 'thread-1', new Map([['thread-1', 'user-message-1']]))).toBe(true);
    expect(isThreadStreaming(createThread(), 'thread-1', new Map())).toBe(false);
  });

  it('should return active streaming content only from streaming messages', () => {
    const thread = createThread({
      isStreaming: true,
      messages: [
        { id: 'msg-1', role: 'user', content: 'Hello', timestamp: '2026-01-01T00:00:00.000Z' },
        { id: 'streaming-job-1', role: 'assistant', content: 'Partial ▊', timestamp: '2026-01-01T00:00:01.000Z' },
      ],
    });

    expect(getStreamingContent(thread)).toBe('Partial ▊');
    expect(getStreamingContent(createThread({ ...thread, isStreaming: false }))).toBe('');
  });

  it('should finalize interrupted streaming messages with a permanent ID and note', () => {
    const finalized = finalizeInterruptedMessage(createThread({
      isStreaming: true,
      messages: [
        { id: 'msg-1', role: 'user', content: 'Hello', timestamp: '2026-01-01T00:00:00.000Z' },
        { id: 'streaming-job-1', role: 'assistant', content: 'Partial ▊', timestamp: '2026-01-01T00:00:01.000Z' },
      ],
    }));

    expect(finalized).toMatchObject({
      isStreaming: false,
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: [
        { id: 'msg-1' },
        {
          id: 'streaming-job-1',
          role: 'assistant',
          content: 'Partial\n\n*(Response interrupted)*',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
  });

  it('should remove empty interrupted streaming messages', () => {
    const finalized = finalizeInterruptedMessage(createThread({
      isStreaming: true,
      messages: [
        { id: 'msg-1', role: 'user', content: 'Hello', timestamp: '2026-01-01T00:00:00.000Z' },
        { id: 'streaming-job-1', role: 'assistant', content: ' ▊', timestamp: '2026-01-01T00:00:01.000Z' },
      ],
    }));

    expect(finalized?.messages).toEqual([{ id: 'msg-1', role: 'user', content: 'Hello', timestamp: '2026-01-01T00:00:00.000Z' }]);
    expect(finalized?.isStreaming).toBe(false);
  });
});

// =============================================================================
// renderHook integration tests for useLearningChatStream
// =============================================================================

function streamingThread(id: string, overrides: Partial<Thread> = {}): Thread {
  return createThread({ id, isStreaming: true, ...overrides });
}

function mkChatOp(jobId: string, threadId: string): ActiveOperation {
  return {
    id: `op-${jobId}`,
    status: 'in-progress',
    meta: {
      type: 'chat-response',
      startedAt: '2026-01-01T00:00:00.000Z',
      targetId: threadId,
      jobId,
    },
  };
}

function setChatOps(ops: ActiveOperation[]) {
  operationsState.setChatMessages(
    new Map(ops.map((op) => [op.meta.jobId ?? op.id, op])),
  );
}

const origEventSource = globalThis.EventSource;

function renderChatStream(initial: { threads: Thread[]; activeThread: Thread | null; activeThreadId: string | null }) {
  const refreshThreads = vi.fn(async () => undefined);
  const selectThread = vi.fn();
  const view = renderHook(
    ({ threads, activeThread, activeThreadId }) =>
      useLearningChatStream({
        threads,
        activeThread,
        activeThreadId,
        isThreadsLoading: false,
        refreshThreads,
        selectThread,
      }),
    { initialProps: initial },
  );
  return { ...view, refreshThreads, selectThread };
}

describe('useLearningChatStream (renderHook)', () => {
  beforeEach(() => {
    operationsState.reset();
    cursorState.get = 0;
    cursorState.setCalls = [];
    cursorState.evictCalls = [];
    threadStoreState.updateCalls = [];
    eventSources.length = 0;
    globalThis.EventSource = FakeES as unknown as typeof EventSource;
  });

  afterEach(() => {
    globalThis.EventSource = origEventSource;
    vi.useRealTimers();
  });

  it('calls operationsManager.initialize exactly once across rerenders', async () => {
    const { rerender } = renderChatStream({ threads: [], activeThread: null, activeThreadId: null });
    await waitFor(() => expect(operationsState.initializeMock.calls).toBe(1));
    rerender({ threads: [], activeThread: null, activeThreadId: null });
    rerender({ threads: [createThread()], activeThread: null, activeThreadId: null });
    await waitFor(() => expect(operationsState.initializeMock.calls).toBe(1));
  });

  it('does not open an EventSource until a matching chat op is registered, then opens it on snapshot change', async () => {
    const thread = streamingThread('t1');
    renderChatStream({ threads: [thread], activeThread: thread, activeThreadId: 't1' });

    // Streaming thread is present but no chat op yet — must NOT open ES.
    await Promise.resolve();
    expect(eventSources).toHaveLength(0);

    // Register the chat op AFTER the effect has already run; this is the
    // exact race the useSyncExternalStore wiring protects against.
    act(() => {
      setChatOps([mkChatOp('j1', 't1')]);
      operationsState.notify();
    });

    await waitFor(() => expect(eventSources).toHaveLength(1));
    expect(eventSources[0].url).toBe('/api/jobs/j1/stream');
  });

  it('includes ?cursor=N in the SSE URL when getCursor returns a positive value (reload-resume)', async () => {
    cursorState.get = 42;
    const thread = streamingThread('t1');
    setChatOps([mkChatOp('j1', 't1')]);
    renderChatStream({ threads: [thread], activeThread: thread, activeThreadId: 't1' });

    await waitFor(() => expect(eventSources).toHaveLength(1));
    expect(eventSources[0].url).toBe('/api/jobs/j1/stream?cursor=42');
  });

  it('does not reopen the EventSource when operationsManager notifies with a new snapshot ref but unchanged chatSubscriptionKey', async () => {
    const thread = streamingThread('t1');
    setChatOps([mkChatOp('j1', 't1')]);
    renderChatStream({ threads: [thread], activeThread: thread, activeThreadId: 't1' });

    await waitFor(() => expect(eventSources).toHaveLength(1));

    // Swap the snapshot reference so useSyncExternalStore actually forwards
    // the change, then notify. The chat subscription key (threadId:jobId)
    // is unchanged, so the SSE effect must NOT tear down and reopen — this
    // is the contract that prevents churn from unrelated operations
    // snapshot updates from killing in-flight streams.
    act(() => {
      setChatOps([mkChatOp('j1', 't1')]);
      operationsState.notify();
    });
    await Promise.resolve();
    expect(eventSources).toHaveLength(1);
    expect(eventSources[0].closed).toBe(false);

    act(() => {
      setChatOps([mkChatOp('j1', 't1')]);
      operationsState.notify();
    });
    await Promise.resolve();
    expect(eventSources).toHaveLength(1);
    expect(eventSources[0].closed).toBe(false);
  });

  it('replaces the EventSource when the jobId for a streaming thread changes', async () => {
    const thread = streamingThread('t1');
    setChatOps([mkChatOp('j-old', 't1')]);
    renderChatStream({ threads: [thread], activeThread: thread, activeThreadId: 't1' });

    await waitFor(() => expect(eventSources).toHaveLength(1));
    const first = eventSources[0];
    expect(first.url).toBe('/api/jobs/j-old/stream');

    act(() => {
      setChatOps([mkChatOp('j-new', 't1')]);
      operationsState.notify();
    });

    await waitFor(() => expect(eventSources).toHaveLength(2));
    expect(first.closed).toBe(true);
    expect(eventSources[1].url).toBe('/api/jobs/j-new/stream');
  });

  it('updates the cursor on each message with a numeric lastEventId', async () => {
    const thread = streamingThread('t1');
    setChatOps([mkChatOp('j1', 't1')]);
    renderChatStream({ threads: [thread], activeThread: thread, activeThreadId: 't1' });

    await waitFor(() => expect(eventSources).toHaveLength(1));
    const es = eventSources[0];

    es.onmessage?.({ lastEventId: '7', data: '{"delta":"x"}' } as unknown as MessageEvent);
    es.onmessage?.({ lastEventId: 'not-a-number', data: '{"delta":"y"}' } as unknown as MessageEvent);
    es.onmessage?.({ lastEventId: '9', data: '{"delta":"z"}' } as unknown as MessageEvent);

    expect(cursorState.setCalls).toEqual([
      { jobId: 'j1', cursor: 7 },
      { jobId: 'j1', cursor: 9 },
    ]);
  });

  it('on [DONE] evicts cursor, closes the EventSource, completes the job, and refreshes threads immediately', async () => {
    const thread = streamingThread('t1');
    setChatOps([mkChatOp('j1', 't1')]);
    const { refreshThreads } = renderChatStream({
      threads: [thread],
      activeThread: thread,
      activeThreadId: 't1',
    });

    await waitFor(() => expect(eventSources).toHaveLength(1));
    const es = eventSources[0];

    es.onmessage?.({ lastEventId: '10', data: '[DONE]' } as unknown as MessageEvent);

    expect(cursorState.evictCalls).toEqual(['j1']);
    expect(es.closed).toBe(true);
    expect(operationsState.completeMock.calls).toEqual(['j1']);
    await waitFor(() => expect(refreshThreads).toHaveBeenCalledTimes(1));
  });

  it('coalesces refreshThreads calls on rapid delta frames (~400ms debounce)', async () => {
    vi.useFakeTimers();
    const thread = streamingThread('t1');
    setChatOps([mkChatOp('j1', 't1')]);
    const { refreshThreads } = renderChatStream({
      threads: [thread],
      activeThread: thread,
      activeThreadId: 't1',
    });

    // Flush the dynamic import + effect using a real-timer microtask wait.
    await vi.waitFor(() => expect(eventSources).toHaveLength(1));
    const es = eventSources[0];

    es.onmessage?.({ lastEventId: '1', data: '{"delta":"a"}' } as unknown as MessageEvent);
    es.onmessage?.({ lastEventId: '2', data: '{"delta":"b"}' } as unknown as MessageEvent);
    es.onmessage?.({ lastEventId: '3', data: '{"delta":"c"}' } as unknown as MessageEvent);

    expect(refreshThreads).toHaveBeenCalledTimes(0);
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(refreshThreads).toHaveBeenCalledTimes(1);
  });

  it('closes all open EventSources and unsubscribes from operationsManager on unmount', async () => {
    const thread = streamingThread('t1');
    setChatOps([mkChatOp('j1', 't1')]);
    const view = renderChatStream({ threads: [thread], activeThread: thread, activeThreadId: 't1' });

    await waitFor(() => expect(eventSources).toHaveLength(1));
    expect(operationsState.listeners.size).toBeGreaterThan(0);

    view.unmount();

    expect(eventSources[0].closed).toBe(true);
    expect(operationsState.listeners.size).toBe(0);
  });

  it('clears pendingStreamMessages once the storage thread settles with a final assistant message', async () => {
    // Bridge state: pending is set BEFORE the worker flips isStreaming.
    // When the thread settles to isStreaming:false + a fresh assistant
    // message, the cleanup effect must drop the pending entry.
    const tBridge: Thread = createThread({
      id: 't1',
      isStreaming: false,
      messages: [
        { id: 'user-1', role: 'user', content: 'Hi', timestamp: '2026-01-01T00:00:00.000Z' },
      ],
    });
    const { result, rerender } = renderChatStream({
      threads: [tBridge],
      activeThread: tBridge,
      activeThreadId: 't1',
    });
    act(() => result.current.markStreamPending('t1', 'user-1'));
    expect(result.current.isStreaming).toBe(true);

    const tSettled: Thread = {
      ...tBridge,
      messages: [
        ...tBridge.messages,
        { id: 'asst-1', role: 'assistant', content: 'Hello!', timestamp: '2026-01-01T00:00:01.000Z' },
      ],
    };
    rerender({ threads: [tSettled], activeThread: tSettled, activeThreadId: 't1' });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
  });

  it('keeps pendingStreamMessages set when no assistant response has arrived yet (bridge state)', async () => {
    const tBridge: Thread = createThread({
      id: 't1',
      isStreaming: false,
      messages: [
        { id: 'user-1', role: 'user', content: 'Hi', timestamp: '2026-01-01T00:00:00.000Z' },
      ],
    });
    const { result, rerender } = renderChatStream({
      threads: [tBridge],
      activeThread: tBridge,
      activeThreadId: 't1',
    });
    act(() => result.current.markStreamPending('t1', 'user-1'));
    expect(result.current.isStreaming).toBe(true);

    // Rerender with the same shape (no assistant yet) — pending must survive
    // so the UI keeps the user's message marked as awaiting a response.
    rerender({ threads: [tBridge], activeThread: tBridge, activeThreadId: 't1' });
    await Promise.resolve();
    expect(result.current.isStreaming).toBe(true);
  });

  it('finalizes a storage thread when it has been streaming with no cursor message for > 5s', async () => {
    const stale: Thread = createThread({
      id: 't1',
      isStreaming: true,
      updatedAt: new Date(Date.now() - 10_000).toISOString(),
      messages: [
        { id: 'user-1', role: 'user', content: 'Hi', timestamp: '2026-01-01T00:00:00.000Z' },
      ],
    });
    renderChatStream({ threads: [stale], activeThread: stale, activeThreadId: 't1' });

    await waitFor(() => expect(threadStoreState.updateCalls.length).toBeGreaterThan(0));
    const updated = threadStoreState.updateCalls[0];
    expect(updated.isStreaming).toBe(false);
    expect(updated.id).toBe('t1');
  });

  it('treats the active thread as streaming when only a pendingStreamMessages entry exists', async () => {
    const thread = createThread({ id: 't1', isStreaming: false });
    const { result } = renderChatStream({
      threads: [thread],
      activeThread: thread,
      activeThreadId: 't1',
    });
    expect(result.current.isStreaming).toBe(false);

    act(() => result.current.markStreamPending('t1', 'user-1'));
    expect(result.current.isStreaming).toBe(true);
  });

  it('extracts streamingContent from a cursor-glyph assistant message regardless of id format', () => {
    const thread = createThread({
      id: 't1',
      isStreaming: true,
      messages: [
        { id: 'user-1', role: 'user', content: 'Hi', timestamp: '2026-01-01T00:00:00.000Z' },
        {
          id: 'd3b0a4e8-uuid-style-id',
          role: 'assistant',
          content: 'Partial ▊',
          timestamp: '2026-01-01T00:00:01.000Z',
        },
      ],
    });
    const { result } = renderChatStream({
      threads: [thread],
      activeThread: thread,
      activeThreadId: 't1',
    });
    expect(result.current.streamingContent).toBe('Partial ▊');
  });
});

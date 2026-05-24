/**
 * useLearningChat hook tests.
 *
 * Scope (this file): the orchestration unique to useLearningChat — primarily
 * `sendMessage` (resolve target thread → ensure title → guard against double
 * dispatch → append user message → mark pending → POST /api/jobs → seed
 * stream tracking → recover on failure).
 *
 * Stream/SSE concerns live in `use-learning-chat-stream.test.ts` and are
 * NOT re-asserted here. That peer hook is stubbed so a single integration
 * surface (fetch) is enough to drive every scenario.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Thread } from '@/lib/threads';
import { useLearningChat } from './use-learning-chat';

// -----------------------------------------------------------------------------
// Stubs for the peer collaborators (covered by their own dedicated test files)
// -----------------------------------------------------------------------------

const streamState = vi.hoisted(() => ({
  registerStream: vi.fn(),
  markStreamPending: vi.fn(),
  clearPendingStream: vi.fn(),
  stopStreaming: vi.fn(),
  /** Mutable view returned by the stub hook so tests can observe pending IDs. */
  pending: new Set<string>(),
  reset() {
    this.registerStream.mockReset();
    this.markStreamPending.mockReset().mockImplementation((id: string) => {
      this.pending.add(id);
    });
    this.clearPendingStream.mockReset().mockImplementation((id: string) => {
      this.pending.delete(id);
    });
    this.stopStreaming.mockReset();
    this.pending.clear();
  },
}));

vi.mock('./use-learning-chat-stream', () => ({
  useLearningChatStream: () => ({
    allStreamingThreadIds: Array.from(streamState.pending),
    clearPendingStream: streamState.clearPendingStream,
    isStreaming: streamState.pending.size > 0,
    markStreamPending: streamState.markStreamPending,
    registerStream: streamState.registerStream,
    stopStreaming: streamState.stopStreaming,
    streamingAssistantMessageId: null,
    streamingContent: '',
    streamingThreadId: null,
    streamingToolEvents: [],
  }),
}));

// operationsManager.registerExistingJob has a fire-and-forget side effect into
// activeOperationsStore (in-memory on the client). Stub to a no-op so the
// SUT's wiring stays honest while the test stays focused.
const opsRegister = vi.hoisted(() => vi.fn());
vi.mock('@/lib/operations', () => ({
  operationsManager: { registerExistingJob: opsRegister },
}));

vi.mock('@/lib/utils/id-generator', () => ({
  generateId: vi.fn((prefix: string) => `${prefix}-fixed`),
  generateMessageId: vi.fn(() => 'msg-fixed'),
}));

vi.mock('@/lib/utils/date-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/date-utils')>();
  return { ...actual, now: () => '2026-01-01T00:00:00.000Z', nowMs: () => 1_700_000_000_000 };
});

// crypto.randomUUID is referenced by startChatJob to mint a stable assistant id.
Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: { ...globalThis.crypto, randomUUID: () => '00000000-0000-4000-8000-000000000000' },
});

// -----------------------------------------------------------------------------
// Tiny fetch responder backed by an in-memory thread list. apiPost/apiGet route
// through global.fetch, which is already mocked in src/test/setup.ts.
// -----------------------------------------------------------------------------

interface FakeBackend {
  threads: Thread[];
  jobIdSeq: number;
  /** Optional failure hook — when set, /api/jobs POSTs reject with this. */
  jobFailure?: Error;
  storagePosts: Array<{ threads: Thread[] }>;
  jobPosts: Array<Record<string, unknown>>;
}

const backend: FakeBackend = {
  threads: [],
  jobIdSeq: 0,
  storagePosts: [],
  jobPosts: [],
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function installFetch(): void {
  vi.mocked(global.fetch).mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url === '/api/threads/storage' && method === 'GET') {
      return jsonResponse({ threads: backend.threads });
    }
    if (url === '/api/threads/storage' && method === 'POST') {
      const body = JSON.parse((init?.body as string) ?? '{"threads":[]}') as {
        threads: Thread[];
      };
      backend.threads = body.threads;
      backend.storagePosts.push(body);
      return jsonResponse({ ok: true });
    }
    if (url === '/api/jobs' && method === 'POST') {
      const body = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
      backend.jobPosts.push(body);
      if (backend.jobFailure) {
        return jsonResponse({ error: backend.jobFailure.message }, { status: 500 });
      }
      backend.jobIdSeq += 1;
      return jsonResponse({ id: `job-${backend.jobIdSeq}` });
    }
    // Anything else: surface as 404 so unexpected calls fail loudly.
    return jsonResponse({ error: `unexpected ${method} ${url}` }, { status: 404 });
  });
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    title: 'Existing Thread',
    context: { repos: [] },
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function renderHookWithSeed(seed: Thread[] = []) {
  backend.threads = seed;
  const view = renderHook(() => useLearningChat());
  await waitFor(() => expect(view.result.current.isThreadsLoading).toBe(false));
  return view;
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

beforeEach(() => {
  streamState.reset();
  opsRegister.mockReset();
  backend.threads = [];
  backend.jobIdSeq = 0;
  backend.jobFailure = undefined;
  backend.storagePosts = [];
  backend.jobPosts = [];
  installFetch();
});

describe('useLearningChat — composed state surface', () => {
  it('exposes the union of thread and stream state', async () => {
    const { result } = await renderHookWithSeed([makeThread()]);

    expect(result.current.threads.map((t) => t.id)).toEqual(['thread-1']);
    expect(result.current.activeThread?.id).toBe('thread-1');
    expect(result.current.activeThreadId).toBe('thread-1');
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingThreadIds).toEqual([]);
    expect(typeof result.current.sendMessage).toBe('function');
    expect(typeof result.current.stopStreaming).toBe('function');
  });
});

describe('useLearningChat.sendMessage — input handling', () => {
  it.each<[string, string]>([
    ['empty string', ''],
    ['whitespace', '   \t\n  '],
  ])('is a no-op for %s input', async (_, content) => {
    const { result } = await renderHookWithSeed([makeThread()]);

    await act(async () => {
      await result.current.sendMessage(content);
    });

    expect(backend.jobPosts).toHaveLength(0);
    expect(streamState.markStreamPending).not.toHaveBeenCalled();
    expect(streamState.registerStream).not.toHaveBeenCalled();
  });
});

describe('useLearningChat.sendMessage — target thread resolution', () => {
  it('dispatches against the currently active thread', async () => {
    const { result } = await renderHookWithSeed([makeThread({ id: 'thread-active' })]);

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(backend.jobPosts).toHaveLength(1);
    expect(backend.jobPosts[0]).toMatchObject({
      type: 'chat-response',
      targetId: 'thread-active',
      input: expect.objectContaining({ threadId: 'thread-active', prompt: 'Hello' }),
    });
  });

  it('honours an explicit threadId, bypassing the active thread', async () => {
    const explicit = makeThread({ id: 'thread-explicit', title: 'Explicit' });
    const active = makeThread({ id: 'thread-active', title: 'Active' });
    const { result } = await renderHookWithSeed([active, explicit]);
    // The hook auto-selects the first thread; we still pass an explicit override.

    await act(async () => {
      await result.current.sendMessage('Hi', { threadId: 'thread-explicit' });
    });

    expect(backend.jobPosts[0]).toMatchObject({ targetId: 'thread-explicit' });
  });

  it('auto-creates a thread when none exists, titled from the first message', async () => {
    const { result } = await renderHookWithSeed([]);

    await act(async () => {
      await result.current.sendMessage('Teach me about generics');
    });

    expect(backend.threads).toHaveLength(1);
    expect(backend.threads[0].title).toBe('Teach me about generics');
    expect(backend.jobPosts[0]).toMatchObject({ targetId: backend.threads[0].id });
  });

  it('truncates long auto-titles to ~30 chars with an ellipsis', async () => {
    const { result } = await renderHookWithSeed([]);
    const long = 'This is a very lengthy initial question about React hooks';

    await act(async () => {
      await result.current.sendMessage(long);
    });

    expect(backend.threads[0].title).toBe(`${long.slice(0, 30)}...`);
  });

  it('renames a placeholder "New Thread" with empty messages on first send', async () => {
    const placeholder = makeThread({ id: 'thread-new', title: 'New Thread', messages: [] });
    const { result } = await renderHookWithSeed([placeholder]);

    await act(async () => {
      await result.current.sendMessage('First question');
    });

    const renamed = backend.threads.find((t) => t.id === 'thread-new');
    expect(renamed?.title).toBe('First question');
  });
});

describe('useLearningChat.sendMessage — pending stream bookkeeping', () => {
  it('marks the thread pending and registers the stream when the job starts', async () => {
    const { result } = await renderHookWithSeed([makeThread({ id: 'thread-x' })]);

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(streamState.markStreamPending).toHaveBeenCalledWith('thread-x', 'msg-fixed');
    expect(streamState.registerStream).toHaveBeenCalledWith(
      'job-1',
      'thread-x',
      '00000000-0000-4000-8000-000000000000',
    );
    await waitFor(() => expect(result.current.streamingThreadIds).toContain('thread-x'));
  });

  it('clears the pending entry when the /api/jobs POST fails', async () => {
    backend.jobFailure = new Error('boom');
    const { result } = await renderHookWithSeed([makeThread({ id: 'thread-x' })]);

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(streamState.clearPendingStream).toHaveBeenCalledWith('thread-x');
    await waitFor(() => expect(result.current.streamingThreadIds).not.toContain('thread-x'));
    expect(streamState.registerStream).not.toHaveBeenCalled();
  });

  it('skips dispatch when storage already marks the thread as streaming', async () => {
    const busy = makeThread({ id: 'thread-busy', isStreaming: true });
    const { result } = await renderHookWithSeed([busy]);

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(backend.jobPosts).toHaveLength(0);
    expect(streamState.markStreamPending).not.toHaveBeenCalled();
    expect(streamState.registerStream).not.toHaveBeenCalled();
  });
});

describe('useLearningChat.sendMessage — job payload composition', () => {
  it('passes useGitHubTools and repos through to /api/jobs', async () => {
    const { result } = await renderHookWithSeed([makeThread({ id: 'thread-x' })]);

    await act(async () => {
      await result.current.sendMessage('Q', {
        useGitHubTools: true,
        repos: [
          { fullName: 'octo/one', owner: 'octo', name: 'one' },
          { fullName: 'octo/two', owner: 'octo', name: 'two' },
        ],
      });
    });

    expect(backend.jobPosts[0]).toMatchObject({
      input: expect.objectContaining({
        useGitHubTools: true,
        repos: ['octo/one', 'octo/two'],
        assistantMessageId: '00000000-0000-4000-8000-000000000000',
        learningMode: true,
      }),
    });
  });

  it('falls back to the thread context repos when none are supplied', async () => {
    const thread = makeThread({
      id: 'thread-x',
      context: { repos: [{ fullName: 'octo/ctx', owner: 'octo', name: 'ctx' }] },
    });
    const { result } = await renderHookWithSeed([thread]);

    await act(async () => {
      await result.current.sendMessage('Q');
    });

    expect(backend.jobPosts[0]).toMatchObject({
      input: expect.objectContaining({ repos: ['octo/ctx'] }),
    });
  });
});

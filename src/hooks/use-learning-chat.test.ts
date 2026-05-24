/**
 * useLearningChat hook tests.
 *
 * Scope: the orchestration unique to `useLearningChat` — primarily `sendMessage`.
 * SSE/stream concerns live in `use-learning-chat-stream.test.ts`; the peer hook
 * is stubbed here so a single integration surface (fetch) drives the scenarios.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Thread } from '@/lib/threads';
import { useLearningChat } from './use-learning-chat';

// --- Peer hook + tiny module stubs -----------------------------------------
const streamState = vi.hoisted(() => ({
  registered: [] as Array<{ jobId: string; threadId: string; assistantId: string }>,
  marked: [] as Array<{ threadId: string; userMessageId: string }>,
  cleared: [] as string[],
  pending: new Set<string>(),
  reset() {
    this.registered.length = 0;
    this.marked.length = 0;
    this.cleared.length = 0;
    this.pending.clear();
  },
}));

vi.mock('./use-learning-chat-stream', () => ({
  useLearningChatStream: () => ({
    allStreamingThreadIds: Array.from(streamState.pending),
    clearPendingStream: (id: string) => {
      streamState.cleared.push(id);
      streamState.pending.delete(id);
    },
    isStreaming: streamState.pending.size > 0,
    markStreamPending: (threadId: string, userMessageId: string) => {
      streamState.marked.push({ threadId, userMessageId });
      streamState.pending.add(threadId);
    },
    registerStream: (jobId: string, threadId: string, assistantId: string) => {
      streamState.registered.push({ jobId, threadId, assistantId });
    },
    stopStreaming: () => {},
    streamingAssistantMessageId: null,
    streamingContent: '',
    streamingThreadId: null,
    streamingToolEvents: [],
  }),
}));

const opsRegistered = vi.hoisted(() => [] as Array<{ jobId: string; threadId: string }>);
vi.mock('@/lib/operations', () => ({
  operationsManager: {
    registerExistingJob: (jobId: string, _t: string, threadId: string) =>
      opsRegistered.push({ jobId, threadId }),
  },
}));

vi.mock('@/lib/utils/id-generator', () => ({
  generateId: (prefix: string) => `${prefix}-fixed`,
  generateMessageId: () => 'msg-fixed',
}));

vi.mock('@/lib/utils/date-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/date-utils')>();
  return { ...actual, now: () => '2026-01-01T00:00:00.000Z' };
});

// trigger-metadata requires a v4 UUID for correlationId/assistantMessageId.
const ASSISTANT_ID = '00000000-0000-4000-8000-000000000000';
Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: { ...globalThis.crypto, randomUUID: () => ASSISTANT_ID },
});

// --- In-memory fetch responder (apiPost/apiGet → global.fetch from setup.ts) -

interface FakeBackend {
  threads: Thread[];
  jobIdSeq: number;
  jobFailure?: Error;
  jobPosts: Array<Record<string, unknown>>;
}
const backend: FakeBackend = { threads: [], jobIdSeq: 0, jobPosts: [] };

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

function installFetch(): void {
  vi.mocked(global.fetch).mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url === '/api/threads/storage' && method === 'GET') {
      return json({ threads: backend.threads });
    }
    if (url === '/api/threads/storage' && method === 'POST') {
      backend.threads = (JSON.parse((init?.body as string) ?? '{"threads":[]}') as {
        threads: Thread[];
      }).threads;
      return json({ ok: true });
    }
    if (url === '/api/jobs' && method === 'POST') {
      backend.jobPosts.push(JSON.parse((init?.body as string) ?? '{}'));
      if (backend.jobFailure) return json({ error: backend.jobFailure.message }, { status: 500 });
      backend.jobIdSeq += 1;
      return json({ id: `job-${backend.jobIdSeq}` });
    }
    return json({ error: `unexpected ${method} ${url}` }, { status: 404 });
  });
}

const makeThread = (overrides: Partial<Thread> = {}): Thread => ({
  id: 'thread-1',
  title: 'Existing Thread',
  context: { repos: [] },
  messages: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

async function renderHookWithSeed(seed: Thread[] = []) {
  backend.threads = seed;
  const view = renderHook(() => useLearningChat());
  await waitFor(() => expect(view.result.current.isThreadsLoading).toBe(false));
  return view;
}

// --- Tests -----------------------------------------------------------------

beforeEach(() => {
  streamState.reset();
  opsRegistered.length = 0;
  backend.threads = [];
  backend.jobIdSeq = 0;
  backend.jobFailure = undefined;
  backend.jobPosts = [];
  installFetch();
});

describe('useLearningChat — composed state surface', () => {
  it('exposes thread state and the action API', async () => {
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

describe('useLearningChat.sendMessage — short-circuits without dispatching', () => {
  it.each<[string, string, () => Thread[]]>([
    ['empty string', '', () => [makeThread()]],
    ['whitespace only', '   \t\n  ', () => [makeThread()]],
    ['thread already streaming in storage', 'Hi', () => [makeThread({ isStreaming: true })]],
  ])('%s', async (_, content, seed) => {
    const { result } = await renderHookWithSeed(seed());

    await act(async () => {
      await result.current.sendMessage(content);
    });

    expect(backend.jobPosts).toEqual([]);
    expect(streamState.marked).toEqual([]);
    expect(streamState.registered).toEqual([]);
    expect(opsRegistered).toEqual([]);
  });
});

describe('useLearningChat.sendMessage — target thread resolution', () => {
  it('dispatches against the currently active thread', async () => {
    const { result } = await renderHookWithSeed([makeThread({ id: 'thread-active' })]);

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(backend.jobPosts[0]).toMatchObject({
      type: 'chat-response',
      targetId: 'thread-active',
      input: expect.objectContaining({ threadId: 'thread-active', prompt: 'Hello' }),
    });
  });

  it('honours an explicit threadId, bypassing the active thread', async () => {
    const active = makeThread({ id: 'thread-active' });
    const explicit = makeThread({ id: 'thread-explicit' });
    const { result } = await renderHookWithSeed([active, explicit]);

    await act(async () => {
      await result.current.sendMessage('Hi', { threadId: 'thread-explicit' });
    });

    expect(backend.jobPosts[0]).toMatchObject({ targetId: 'thread-explicit' });
  });

  it.each<[string, string, string]>([
    ['short message → exact title', 'Teach me generics', 'Teach me generics'],
    ['long message → 30-char prefix + ellipsis',
      'This is a very lengthy initial question about React hooks',
      'This is a very lengthy initial...'],
  ])('auto-creates a thread when none exists (%s)', async (_, message, expectedTitle) => {
    const { result } = await renderHookWithSeed([]);

    await act(async () => {
      await result.current.sendMessage(message);
    });

    expect(backend.threads).toHaveLength(1);
    expect(backend.threads[0].title).toBe(expectedTitle);
    expect(backend.jobPosts[0]).toMatchObject({ targetId: backend.threads[0].id });
  });

  it('renames a placeholder "New Thread" with empty messages on first send', async () => {
    const placeholder = makeThread({ id: 'thread-new', title: 'New Thread', messages: [] });
    const { result } = await renderHookWithSeed([placeholder]);

    await act(async () => {
      await result.current.sendMessage('First question');
    });

    expect(backend.threads.find((t) => t.id === 'thread-new')?.title).toBe('First question');
  });
});

describe('useLearningChat.sendMessage — pending stream bookkeeping', () => {
  it('marks the thread pending, registers the stream, and exposes it as streaming', async () => {
    const { result } = await renderHookWithSeed([makeThread({ id: 'thread-x' })]);

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(streamState.marked).toEqual([{ threadId: 'thread-x', userMessageId: 'msg-fixed' }]);
    expect(streamState.registered).toEqual([
      { jobId: 'job-1', threadId: 'thread-x', assistantId: ASSISTANT_ID },
    ]);
    expect(opsRegistered).toEqual([{ jobId: 'job-1', threadId: 'thread-x' }]);
    await waitFor(() => expect(result.current.streamingThreadIds).toContain('thread-x'));
    expect(result.current.isStreaming).toBe(true);
  });

  it('clears the pending entry when the /api/jobs POST fails', async () => {
    backend.jobFailure = new Error('boom');
    const { result } = await renderHookWithSeed([makeThread({ id: 'thread-x' })]);

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(streamState.cleared).toEqual(['thread-x']);
    expect(streamState.registered).toEqual([]);
    expect(opsRegistered).toEqual([]);
    await waitFor(() => expect(result.current.streamingThreadIds).not.toContain('thread-x'));
  });
});

describe('useLearningChat.sendMessage — job payload composition', () => {
  const repo = (n: string) => ({ fullName: `octo/${n}`, owner: 'octo', name: n });

  it.each([
    ['forwards explicit repos and profile',
      { profile: 'learning-github' as const, repos: [repo('one'), repo('two')] },
      { profile: 'learning-github', repos: ['octo/one', 'octo/two'] }, [] as ReturnType<typeof repo>[]],
    ['falls back to thread.context.repos when none supplied',
      undefined, { profile: 'learning', repos: ['octo/ctx'] }, [repo('ctx')]],
    ['defaults to no repos when neither option nor context provides any',
      undefined, { profile: 'learning', repos: [] }, [] as ReturnType<typeof repo>[]],
  ] as const)('%s', async (_, options, expected, contextRepos) => {
    const { result } = await renderHookWithSeed([
      makeThread({ id: 'thread-x', context: { repos: contextRepos } }),
    ]);
    await act(async () => {
      await result.current.sendMessage('Q', options);
    });
    expect(backend.jobPosts[0]).toMatchObject({
      type: 'chat-response',
      input: expect.objectContaining({
        prompt: 'Q',
        threadId: 'thread-x',
        assistantMessageId: ASSISTANT_ID,
        ...expected,
      }),
    });
  });
});

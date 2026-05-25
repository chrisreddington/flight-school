/**
 * useThreads — behaviour suite. Mocks live at system seams only: `fetch`
 * (the JSON-storage API threadStore wraps) and the logger sink. The
 * threadStore itself runs for real so the tests describe observable hook
 * behaviour, not call-forwarding wiring.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Thread } from '@/lib/threads';
import { createQueryTestWrapper } from '@/test/query-test-wrapper';
import { useThreads } from './use-threads';

const { errorSpy } = vi.hoisted(() => ({ errorSpy: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { withTag: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: errorSpy }) },
}));

const fetchMock = global.fetch as unknown as Mock;
const STAMP = '2024-01-01T00:00:00Z';
const okJson = (data: unknown) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => data,
});
const makeThread = (over: Partial<Thread> = {}): Thread => ({
  id: 'thread-1',
  title: 'Thread',
  messages: [],
  context: { repos: [], learningFocus: null },
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});

/** In-memory `/api/threads/storage` driving threadStore through real fetch. */
function mountStorage(seed: Thread[] = []) {
  const state = { threads: [...seed], failPostsOnce: false };
  fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
    const target = typeof url === 'string' ? url : url.toString();
    if (!target.includes('/api/threads/storage')) return okJson({});
    if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
      if (state.failPostsOnce) {
        state.failPostsOnce = false;
        throw new Error('network down');
      }
      state.threads = JSON.parse((init?.body as string) ?? '{"threads":[]}').threads ?? [];
      return okJson({});
    }
    return okJson({ threads: state.threads });
  });
  return state;
}

async function mountHook(seed: Thread[] = []) {
  const state = mountStorage(seed);
  const { wrapper } = createQueryTestWrapper();
  const hook = renderHook(() => useThreads(), { wrapper });
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return { ...hook, state };
}

beforeEach(() => {
  errorSpy.mockReset();
  fetchMock.mockReset();
});

describe('useThreads — initial load', () => {
  it('starts loading then exposes persisted threads', async () => {
    mountStorage([
      makeThread({ id: 'a', title: 'A', updatedAt: '2024-01-02T00:00:00Z' }),
      makeThread({ id: 'b', title: 'B', updatedAt: '2024-01-01T00:00:00Z' }),
    ]);
    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useThreads(), { wrapper });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.threads).toEqual([]);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.threads.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('exposes empty state when storage is empty', async () => {
    const { result } = await mountHook();
    expect(result.current.threads).toEqual([]);
    expect(result.current.activeThread).toBeNull();
    expect(result.current.activeThreadId).toBeNull();
  });
});

describe('useThreads — createThread', () => {
  it('persists a new thread and reflects it in state', async () => {
    const { result } = await mountHook();
    let created!: Thread;
    await act(async () => {
      created = await result.current.createThread({ title: 'Hello' });
    });
    expect(created.title).toBe('Hello');
    expect(result.current.threads).toContainEqual(expect.objectContaining({ id: created.id, title: 'Hello' }));
  });

  it('applies provided context to the persisted thread', async () => {
    const { result } = await mountHook();
    let created!: Thread;
    await act(async () => {
      created = await result.current.createThread({
        title: 'C',
        context: {
          repos: [{ owner: 'u', name: 'r', branch: 'main' }],
          learningFocus: { goal: { id: 'g1', title: 'Learn' } },
        },
      });
    });
    expect(created.context.repos).toHaveLength(1);
    expect(created.context.learningFocus?.goal?.title).toBe('Learn');
  });

  it.each([
    ['true', true, 'created'],
    ['false', false, 'existing'],
  ] as const)('when makeActive=%s selects the %s thread', async (_, makeActive, kind) => {
    const { result } = await mountHook([makeThread({ id: 'existing' })]);
    await act(async () => {
      result.current.selectThread('existing');
    });
    let created!: Thread;
    await act(async () => {
      created = await result.current.createThread({ title: 'New' }, makeActive);
    });
    expect(result.current.activeThreadId).toBe(kind === 'created' ? created.id : 'existing');
  });
});

describe('useThreads — selectThread / activeThread', () => {
  const a = makeThread({ id: 'a', title: 'A', updatedAt: '2024-01-02T00:00:00Z' });
  const b = makeThread({ id: 'b', title: 'B', updatedAt: '2024-01-01T00:00:00Z' });

  it('defaults active thread to the first one', async () => {
    const { result } = await mountHook([a, b]);
    expect(result.current.activeThreadId).toBe('a');
    expect(result.current.activeThread?.title).toBe('A');
  });

  it('switches active thread on selectThread', async () => {
    const { result } = await mountHook([a, b]);
    await act(async () => {
      result.current.selectThread('b');
    });
    expect(result.current.activeThreadId).toBe('b');
    expect(result.current.activeThread?.id).toBe('b');
  });

  it('returns null activeThread when selection points at a missing id', async () => {
    const { result } = await mountHook([a]);
    await act(async () => {
      result.current.selectThread('missing');
    });
    expect(result.current.activeThreadId).toBe('missing');
    expect(result.current.activeThread).toBeNull();
  });
});

describe('useThreads — deleteThread', () => {
  const a = makeThread({ id: 'a', updatedAt: '2024-01-02T00:00:00Z' });
  const b = makeThread({ id: 'b', updatedAt: '2024-01-01T00:00:00Z' });

  it.each([
    {
      label: 'removes the thread but keeps active selection if untouched',
      seed: [a, b],
      select: 'b',
      del: 'a',
      expectIds: ['b'],
      expectActive: 'b',
    },
    {
      label: 'promotes the next remaining thread when active is deleted',
      seed: [a, b],
      select: 'a',
      del: 'a',
      expectIds: ['b'],
      expectActive: 'b',
    },
    {
      label: 'clears active id when the last thread is deleted',
      seed: [a],
      select: 'a',
      del: 'a',
      expectIds: [],
      expectActive: null,
    },
  ])('$label', async ({ seed, select, del, expectIds, expectActive }) => {
    const { result } = await mountHook(seed);
    await act(async () => {
      result.current.selectThread(select);
    });
    await act(async () => {
      await result.current.deleteThread(del);
    });
    await waitFor(() => {
      expect(result.current.threads.map((t) => t.id)).toEqual(expectIds);
    });
    expect(result.current.activeThreadId).toBe(expectActive);
  });
});

describe('useThreads — renameThread', () => {
  it('updates the title in state', async () => {
    const { result } = await mountHook([makeThread({ id: 'a', title: 'Old' })]);
    await act(async () => {
      await result.current.renameThread('a', 'Fresh');
    });
    expect(result.current.threads[0].title).toBe('Fresh');
  });

  it('leaves state unchanged when renaming a missing thread', async () => {
    const seed = makeThread({ id: 'a', title: 'Only' });
    const { result } = await mountHook([seed]);
    await act(async () => {
      await result.current.renameThread('missing', 'Nope');
    });
    expect(result.current.threads).toEqual([seed]);
  });
});

describe('useThreads — updateContext', () => {
  it.each([
    [
      'repos',
      { repos: [{ owner: 'u', name: 'r', branch: 'main' }] },
      (t: Thread) => expect(t.context.repos).toHaveLength(1),
    ],
    [
      'learningFocus',
      { learningFocus: { goal: { id: 'g', title: 'Learn TS' } } },
      (t: Thread) => expect(t.context.learningFocus?.goal?.title).toBe('Learn TS'),
    ],
  ] as const)('merges %s into the thread context', async (_, patch, assertOn) => {
    const { result } = await mountHook([makeThread({ id: 'a' })]);
    await act(async () => {
      await result.current.updateContext('a', patch);
    });
    assertOn(result.current.threads[0]);
  });
});

describe('useThreads — addMessage / updateActiveThread', () => {
  const seed = makeThread({ id: 'a' });

  it('appends a message with generated id + timestamp to the active thread', async () => {
    const { result } = await mountHook([seed]);
    await act(async () => {
      await result.current.addMessage({ role: 'user', content: 'Hello' });
    });
    await waitFor(() => {
      const msgs = result.current.activeThread?.messages ?? [];
      expect(msgs).toHaveLength(1);
    });
    const msgs = result.current.activeThread?.messages ?? [];
    expect(msgs[0]).toMatchObject({ role: 'user', content: 'Hello' });
    expect(msgs[0].id).toMatch(/^msg-/);
    expect(typeof msgs[0].timestamp).toBe('string');
  });

  it('addMessage is a no-op when there is no active thread', async () => {
    const { result } = await mountHook();
    await act(async () => {
      await result.current.addMessage({ role: 'user', content: 'lost' });
    });
    expect(result.current.threads).toEqual([]);
  });

  it('updateActiveThread applies a partial patch and preserves thread id', async () => {
    const { result } = await mountHook([seed]);
    await act(async () => {
      await result.current.updateActiveThread({
        id: 'should-be-ignored',
        title: 'Updated',
        messages: [{ id: 'm1', role: 'assistant', content: 'hi', timestamp: STAMP }],
      });
    });
    const thread = result.current.threads[0];
    expect(thread.id).toBe('a');
    expect(thread.title).toBe('Updated');
    expect(thread.messages).toHaveLength(1);
  });

  it('updateActiveThread targets an explicit thread id when supplied', async () => {
    const other = makeThread({ id: 'b', title: 'B' });
    const { result } = await mountHook([seed, other]);
    await act(async () => {
      await result.current.updateActiveThread({ title: 'B!' }, 'b');
    });
    expect(result.current.threads.find((t) => t.id === 'b')?.title).toBe('B!');
    expect(result.current.threads.find((t) => t.id === 'a')?.title).toBe('Thread');
  });
});

describe('useThreads — refresh', () => {
  it('re-reads threads from storage', async () => {
    const { result, state } = await mountHook([makeThread({ id: 'a', title: 'A' })]);
    state.threads = [makeThread({ id: 'a', title: 'A-renamed' })];
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.threads[0].title).toBe('A-renamed'));
  });
});

describe('useThreads — error handling', () => {
  it.each([
    {
      label: 'createThread re-throws and logs',
      seed: [] as Thread[],
      act: async (api: ReturnType<typeof useThreads>) =>
        expect(api.createThread({ title: 'x' })).rejects.toThrow('network down'),
      logMessage: 'Failed to create thread',
    },
    {
      label: 'deleteThread swallows and logs',
      seed: [makeThread({ id: 'a' })],
      act: async (api: ReturnType<typeof useThreads>) => expect(api.deleteThread('a')).resolves.toBeUndefined(),
      logMessage: 'Failed to delete thread',
    },
    {
      label: 'renameThread swallows and logs',
      seed: [makeThread({ id: 'a' })],
      act: async (api: ReturnType<typeof useThreads>) => expect(api.renameThread('a', 'new')).resolves.toBeUndefined(),
      logMessage: 'Failed to rename thread',
    },
  ])('$label', async ({ seed, act: invoke, logMessage }) => {
    const { result, state } = await mountHook(seed);
    state.failPostsOnce = true;
    await act(async () => {
      await invoke(result.current);
    });
    expect(errorSpy).toHaveBeenCalledWith(logMessage, expect.any(Object));
  });
});

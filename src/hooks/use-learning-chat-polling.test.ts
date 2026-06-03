import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Thread } from '@/lib/threads';
import { createQueryTestWrapper } from '@/test/query-test-wrapper';
import { useLearningChat } from './use-learning-chat';

const state = vi.hoisted(() => ({
  getThreadStorageCalls: 0,
  jobPosts: 0,
  threads: [] as Thread[],
}));

vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(async (url: string) => {
    if (url !== '/api/threads/storage') return {};
    state.getThreadStorageCalls += 1;
    return { threads: state.threads };
  }),
  apiPost: vi.fn(async (url: string, payload: unknown) => {
    if (url === '/api/threads/storage') {
      state.threads = (payload as { threads: Thread[] }).threads;
      return undefined;
    }
    if (url === '/api/jobs') {
      state.jobPosts += 1;
      return { id: `job-${state.jobPosts}` };
    }
    return {};
  }),
  apiDelete: vi.fn(async () => undefined),
}));

vi.mock('@/lib/operations', () => ({
  operationsManager: {
    registerExistingJob: vi.fn(),
  },
}));

vi.mock('./use-learning-chat-stream', () => ({
  useLearningChatStream: () => ({
    allStreamingThreadIds: [],
    clearPendingStream: vi.fn(),
    isStreaming: false,
    markStreamPending: vi.fn(),
    registerStream: vi.fn(),
    stopStreaming: vi.fn(),
    streamingAssistantMessageId: null,
    streamingContent: '',
    streamingThreadId: null,
    streamingToolEvents: [],
  }),
}));

function createThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    title: 'Thread',
    context: { repos: [] },
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('useLearningChat storage fan-out', () => {
  beforeEach(() => {
    state.getThreadStorageCalls = 0;
    state.jobPosts = 0;
    state.threads = [createThread()];
    vi.clearAllMocks();
  });

  it('keeps /api/threads/storage GET calls to two or fewer for one sendMessage', async () => {
    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useLearningChat(), { wrapper });
    await waitFor(() => expect(result.current.isThreadsLoading).toBe(false));

    const getCallsBeforeMessage = state.getThreadStorageCalls;

    await act(async () => {
      await result.current.sendMessage('How do I start?');
    });

    await waitFor(() => expect(state.jobPosts).toBe(1));

    const getCallsForMessage = state.getThreadStorageCalls - getCallsBeforeMessage;
    expect(getCallsForMessage).toBeLessThanOrEqual(2);
  });
});

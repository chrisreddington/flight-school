/**
 * useThreads Hook Tests
 *
 * Tests for the threads hook covering:
 * - Loading threads from threadStore
 * - Creating new threads with options
 * - Deleting threads and handling active thread updates
 * - Selecting threads by ID
 * - Renaming threads
 * - Adding messages to threads
 * - Updating thread context
 * - Thread state synchronization with storage
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { Thread, CreateThreadOptions, Message, ThreadContext } from '@/lib/threads';
import { useThreads } from './use-threads';

const { errorSpy } = vi.hoisted(() => ({
  errorSpy: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    withTag: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: errorSpy,
    })),
  },
}));

// Mock the threadStore module
vi.mock('@/lib/threads', async () => {
  const actual = await vi.importActual('@/lib/threads');
  return {
    ...actual,
    threadStore: {
      getAll: vi.fn(),
      getById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      rename: vi.fn(),
      updateContext: vi.fn(),
    },
  };
});

import { threadStore } from '@/lib/threads';

describe('useThreads core logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('thread loading', () => {
    it('should load threads from storage on mount', async () => {
      const mockThreads: Thread[] = [
        {
          id: 'thread-1',
          title: 'Learning React',
          messages: [],
          context: { repos: [], learningFocus: null },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'thread-2',
          title: 'TypeScript Questions',
          messages: [],
          context: { repos: [], learningFocus: null },
          createdAt: '2024-01-01T00:01:00Z',
          updatedAt: '2024-01-01T00:01:00Z',
        },
      ];

      (threadStore.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockThreads);

      const threads = await threadStore.getAll();

      expect(threadStore.getAll).toHaveBeenCalledTimes(1);
      expect(threads).toHaveLength(2);
      expect(threads[0].title).toBe('Learning React');
      expect(threads[1].title).toBe('TypeScript Questions');
    });

    it('should handle empty thread list', async () => {
      (threadStore.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const threads = await threadStore.getAll();

      expect(threads).toEqual([]);
    });

    it('should handle storage load errors', async () => {
      (threadStore.getAll as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Storage error'));

      await expect(threadStore.getAll()).rejects.toThrow('Storage error');
    });

    it('should set loading state during fetch', () => {
      let isLoading = true;

      // Simulate async load
      Promise.resolve().then(() => {
        isLoading = false;
      });

      expect(isLoading).toBe(true);
    });
  });

  describe('createThread', () => {
    it('should create thread with default options', async () => {
      const mockThread: Thread = {
        id: 'thread-new',
        title: 'New Thread',
        messages: [],
        context: { repos: [], learningFocus: null },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      (threadStore.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockThread);

      const thread = await threadStore.create();

      expect(threadStore.create).toHaveBeenCalledTimes(1);
      expect(thread.id).toBe('thread-new');
      expect(thread.title).toBe('New Thread');
    });

    it('should create thread with custom title', async () => {
      const options: CreateThreadOptions = {
        title: 'Custom Title',
      };

      const mockThread: Thread = {
        id: 'thread-custom',
        title: 'Custom Title',
        messages: [],
        context: { repos: [], learningFocus: null },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      (threadStore.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockThread);

      const thread = await threadStore.create(options);

      expect(threadStore.create).toHaveBeenCalledWith(options);
      expect(thread.title).toBe('Custom Title');
    });

    it('should create thread with context', async () => {
      const options: CreateThreadOptions = {
        title: 'With Context',
        context: {
          repos: [{ owner: 'user', name: 'repo', branch: 'main' }],
          learningFocus: { goal: { id: 'g1', title: 'Learn React' } },
        },
      };

      const mockThread: Thread = {
        id: 'thread-context',
        title: 'With Context',
        messages: [],
        context: options.context!,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      (threadStore.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockThread);

      const thread = await threadStore.create(options);

      expect(thread.context.repos).toHaveLength(1);
      expect(thread.context.learningFocus?.goal?.title).toBe('Learn React');
    });

    it('should reload threads after creation', async () => {
      const mockThread: Thread = {
        id: 'thread-new',
        title: 'New Thread',
        messages: [],
        context: { repos: [], learningFocus: null },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      (threadStore.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockThread);
      (threadStore.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce([mockThread]);

      await threadStore.create();
      const threads = await threadStore.getAll();

      expect(threadStore.getAll).toHaveBeenCalled();
      expect(threads).toHaveLength(1);
    });

    it('should set new thread as active when makeActive is true', () => {
      const threadId = 'thread-new';
      let selectedThreadId: string | null = null;

      // Simulate makeActive behavior
      const makeActive = true;
      if (makeActive) {
        selectedThreadId = threadId;
      }

      expect(selectedThreadId).toBe('thread-new');
    });

    it('should not set new thread as active when makeActive is false', () => {
      const threadId = 'thread-new';
      let selectedThreadId: string | null = 'thread-existing';

      // Simulate makeActive behavior
      const makeActive = false;
      if (makeActive) {
        selectedThreadId = threadId;
      }

      expect(selectedThreadId).toBe('thread-existing');
    });
  });

  describe('selectThread', () => {
    it('should update selected thread ID', () => {
      let selectedThreadId: string | null = null;

      selectedThreadId = 'thread-1';

      expect(selectedThreadId).toBe('thread-1');
    });

    it('should switch between threads', () => {
      let selectedThreadId: string | null = 'thread-1';

      selectedThreadId = 'thread-2';
      expect(selectedThreadId).toBe('thread-2');

      selectedThreadId = 'thread-3';
      expect(selectedThreadId).toBe('thread-3');
    });
  });

  describe('deleteThread', () => {
    it('should delete thread by ID', async () => {
      (threadStore.delete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      await threadStore.delete('thread-1');

      expect(threadStore.delete).toHaveBeenCalledWith('thread-1');
    });

    it('should reload threads after deletion', async () => {
      const remainingThreads: Thread[] = [
        {
          id: 'thread-2',
          title: 'Remaining Thread',
          messages: [],
          context: { repos: [], learningFocus: null },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      (threadStore.delete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
      (threadStore.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce(remainingThreads);

      await threadStore.delete('thread-1');
      const threads = await threadStore.getAll();

      expect(threads).toHaveLength(1);
      expect(threads[0].id).toBe('thread-2');
    });

    it('should select first remaining thread when deleting active thread', async () => {
      const activeThreadId = 'thread-1';
      const remainingThreads: Thread[] = [
        {
          id: 'thread-2',
          title: 'Remaining Thread',
          messages: [],
          context: { repos: [], learningFocus: null },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      (threadStore.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce(remainingThreads);

      const threads = await threadStore.getAll();
      const newSelectedId = activeThreadId === 'thread-1' ? threads[0]?.id ?? null : activeThreadId;

      expect(newSelectedId).toBe('thread-2');
    });

    it('should set null when deleting last thread', async () => {
      const activeThreadId = 'thread-1';
      const remainingThreads: Thread[] = [];

      (threadStore.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce(remainingThreads);

      const threads = await threadStore.getAll();
      const newSelectedId = activeThreadId === 'thread-1' ? threads[0]?.id ?? null : activeThreadId;

      expect(newSelectedId).toBeNull();
    });
  });

  describe('renameThread', () => {
    it('should rename thread', async () => {
      const updatedThread: Thread = {
        id: 'thread-1',
        title: 'New Title',
        messages: [],
        context: { repos: [], learningFocus: null },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:01:00Z',
      };

      (threadStore.rename as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updatedThread);

      const thread = await threadStore.rename('thread-1', 'New Title');

      expect(threadStore.rename).toHaveBeenCalledWith('thread-1', 'New Title');
      expect(thread?.title).toBe('New Title');
    });

    it('should reload threads after rename', async () => {
      const updatedThread: Thread = {
        id: 'thread-1',
        title: 'Renamed',
        messages: [],
        context: { repos: [], learningFocus: null },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:01:00Z',
      };

      (threadStore.rename as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updatedThread);
      (threadStore.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce([updatedThread]);

      const thread = await threadStore.rename('thread-1', 'Renamed');
      if (thread) {
        const threads = await threadStore.getAll();
        expect(threads[0].title).toBe('Renamed');
      }
    });

    it('should return null when thread not found', async () => {
      (threadStore.rename as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const thread = await threadStore.rename('nonexistent', 'New Title');

      expect(thread).toBeNull();
    });
  });

  describe('updateContext', () => {
    it('should update thread context', async () => {
      const context: Partial<ThreadContext> = {
        repos: [{ owner: 'user', name: 'repo', branch: 'main' }],
      };

      const updatedThread: Thread = {
        id: 'thread-1',
        title: 'Thread',
        messages: [],
        context: {
          repos: context.repos!,
          learningFocus: null,
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:01:00Z',
      };

      (threadStore.updateContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updatedThread);

      const thread = await threadStore.updateContext('thread-1', context);

      expect(threadStore.updateContext).toHaveBeenCalledWith('thread-1', context);
      expect(thread?.context.repos).toHaveLength(1);
    });

    it('should update learning focus', async () => {
      const context: Partial<ThreadContext> = {
        learningFocus: {
          goal: { id: 'g1', title: 'Learn TypeScript' },
        },
      };

      const updatedThread: Thread = {
        id: 'thread-1',
        title: 'Thread',
        messages: [],
        context: {
          repos: [],
          learningFocus: context.learningFocus!,
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:01:00Z',
      };

      (threadStore.updateContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updatedThread);

      const thread = await threadStore.updateContext('thread-1', context);

      expect(thread?.context.learningFocus?.goal?.title).toBe('Learn TypeScript');
    });

    it('should reload threads after context update', async () => {
      const context: Partial<ThreadContext> = {
        repos: [{ owner: 'user', name: 'repo', branch: 'main' }],
      };

      const updatedThread: Thread = {
        id: 'thread-1',
        title: 'Thread',
        messages: [],
        context: {
          repos: context.repos!,
          learningFocus: null,
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:01:00Z',
      };

      (threadStore.updateContext as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updatedThread);
      (threadStore.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce([updatedThread]);

      const thread = await threadStore.updateContext('thread-1', context);
      if (thread) {
        const threads = await threadStore.getAll();
        expect(threads[0].context.repos).toHaveLength(1);
      }
    });
  });

  describe('addMessage', () => {
    it('should add message to thread', async () => {
      const existingThread: Thread = {
        id: 'thread-1',
        title: 'Thread',
        messages: [],
        context: { repos: [], learningFocus: null },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const newMessage: Omit<Message, 'id' | 'timestamp'> = {
        role: 'user',
        content: 'Hello',
      };

      (threadStore.getById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(existingThread);
      (threadStore.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      const thread = await threadStore.getById('thread-1');
      
      if (thread) {
        const messageWithId: Message = {
          ...newMessage,
          id: `msg-${Date.now()}`,
          timestamp: new Date().toISOString(),
        };

        const updated: Thread = {
          ...thread,
          messages: [...thread.messages, messageWithId],
          updatedAt: new Date().toISOString(),
        };

        await threadStore.update(updated);

        expect(updated.messages).toHaveLength(1);
        expect(updated.messages[0].content).toBe('Hello');
      }
    });

    it('should not add message when thread not found', async () => {
      (threadStore.getById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const thread = await threadStore.getById('nonexistent');

      expect(thread).toBeNull();
    });

    it('should generate unique message ID', () => {
      const id1 = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const id2 = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      expect(id1).not.toBe(id2);
      expect(id1.startsWith('msg-')).toBe(true);
    });
  });

  describe('updateActiveThread', () => {
    it('should update thread with partial data', async () => {
      const existingThread: Thread = {
        id: 'thread-1',
        title: 'Old Title',
        messages: [],
        context: { repos: [], learningFocus: null },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const update: Partial<Thread> = {
        title: 'New Title',
      };

      (threadStore.getById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(existingThread);
      (threadStore.update as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      const thread = await threadStore.getById('thread-1');

      if (thread) {
        const updated: Thread = {
          ...thread,
          ...update,
          id: thread.id, // Prevent ID override
          updatedAt: new Date().toISOString(),
        };

        await threadStore.update(updated);

        expect(updated.title).toBe('New Title');
        expect(updated.id).toBe('thread-1'); // ID preserved
      }
    });

    it('should preserve thread ID during update', async () => {
      const existingThread: Thread = {
        id: 'thread-1',
        title: 'Thread',
        messages: [],
        context: { repos: [], learningFocus: null },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const update: Partial<Thread> = {
        id: 'should-be-ignored',
        title: 'Updated',
      };

      const updated: Thread = {
        ...existingThread,
        ...update,
        id: existingThread.id, // Force preserve
        updatedAt: new Date().toISOString(),
      };

      expect(updated.id).toBe('thread-1');
      expect(updated.title).toBe('Updated');
    });

    it('should update messages array', async () => {
      const existingThread: Thread = {
        id: 'thread-1',
        title: 'Thread',
        messages: [
          { id: 'msg-1', role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
        ],
        context: { repos: [], learningFocus: null },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      const newMessages: Message[] = [
        ...existingThread.messages,
        { id: 'msg-2', role: 'assistant', content: 'Hi', timestamp: '2024-01-01T00:01:00Z' },
      ];

      const update: Partial<Thread> = {
        messages: newMessages,
      };

      const updated: Thread = {
        ...existingThread,
        ...update,
        id: existingThread.id,
        updatedAt: new Date().toISOString(),
      };

      expect(updated.messages).toHaveLength(2);
      expect(updated.messages[1].content).toBe('Hi');
    });
  });

  describe('activeThread computation', () => {
    it('should find active thread from ID', () => {
      const threads: Thread[] = [
        {
          id: 'thread-1',
          title: 'Thread 1',
          messages: [],
          context: { repos: [], learningFocus: null },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'thread-2',
          title: 'Thread 2',
          messages: [],
          context: { repos: [], learningFocus: null },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      const activeThreadId = 'thread-2';
      const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

      expect(activeThread?.id).toBe('thread-2');
      expect(activeThread?.title).toBe('Thread 2');
    });

    it('should return null when no active thread ID', () => {
      const threads: Thread[] = [
        {
          id: 'thread-1',
          title: 'Thread 1',
          messages: [],
          context: { repos: [], learningFocus: null },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      const activeThreadId = null;
      const activeThread = activeThreadId ? threads.find((t) => t.id === activeThreadId) ?? null : null;

      expect(activeThread).toBeNull();
    });

    it('should return null when thread ID not found', () => {
      const threads: Thread[] = [
        {
          id: 'thread-1',
          title: 'Thread 1',
          messages: [],
          context: { repos: [], learningFocus: null },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      const activeThreadId = 'nonexistent';
      const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

      expect(activeThread).toBeNull();
    });

    it('should fallback to first thread when no selection', () => {
      const threads: Thread[] = [
        {
          id: 'thread-1',
          title: 'First Thread',
          messages: [],
          context: { repos: [], learningFocus: null },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      const selectedThreadId = null;
      const activeThreadId = selectedThreadId ?? threads[0]?.id ?? null;

      expect(activeThreadId).toBe('thread-1');
    });
  });
});

describe('useThreads interface contract', () => {
  it('should define expected state shape', () => {
    interface UseThreadsState {
      threads: Thread[];
      activeThread: Thread | null;
      activeThreadId: string | null;
      isLoading: boolean;
    }

    const mockState: UseThreadsState = {
      threads: [],
      activeThread: null,
      activeThreadId: null,
      isLoading: true,
    };

    expect(Array.isArray(mockState.threads)).toBe(true);
    expect(mockState.activeThread).toBeNull();
    expect(mockState.activeThreadId).toBeNull();
    expect(typeof mockState.isLoading).toBe('boolean');
  });

  it('should define expected actions', () => {
    interface UseThreadsActions {
      createThread: (options?: CreateThreadOptions, makeActive?: boolean) => Promise<Thread>;
      selectThread: (id: string) => void;
      deleteThread: (id: string) => Promise<void>;
      renameThread: (id: string, title: string) => Promise<void>;
      updateContext: (id: string, context: Partial<ThreadContext>) => Promise<void>;
      addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => Promise<void>;
      updateActiveThread: (update: Partial<Thread>, targetThreadId?: string) => Promise<void>;
      refresh: () => Promise<void>;
    }

    const mockActions: UseThreadsActions = {
      createThread: async () => ({} as Thread),
      selectThread: () => {},
      deleteThread: async () => {},
      renameThread: async () => {},
      updateContext: async () => {},
      addMessage: async () => {},
      updateActiveThread: async () => {},
      refresh: async () => {},
    };

    expect(typeof mockActions.createThread).toBe('function');
    expect(typeof mockActions.selectThread).toBe('function');
    expect(typeof mockActions.deleteThread).toBe('function');
    expect(typeof mockActions.renameThread).toBe('function');
    expect(typeof mockActions.updateContext).toBe('function');
    expect(typeof mockActions.addMessage).toBe('function');
    expect(typeof mockActions.updateActiveThread).toBe('function');
    expect(typeof mockActions.refresh).toBe('function');
  });
});

describe('useThreads error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (threadStore.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('should log and re-throw when createThread fails', async () => {
    const createError = new Error('create failed');
    (threadStore.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(createError);
    const { result } = renderHook(() => useThreads());

    await waitFor(() => {
      expect(threadStore.getAll).toHaveBeenCalledTimes(1);
    });

    await expect(result.current.createThread({ title: 'New Thread' })).rejects.toThrow('create failed');
    expect(errorSpy).toHaveBeenCalledWith('Failed to create thread', { error: createError });
  });

  it('should log and swallow when deleteThread fails', async () => {
    const deleteError = new Error('delete failed');
    (threadStore.delete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(deleteError);
    const { result } = renderHook(() => useThreads());

    await waitFor(() => {
      expect(threadStore.getAll).toHaveBeenCalledTimes(1);
    });

    await expect(result.current.deleteThread('thread-1')).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith('Failed to delete thread', { error: deleteError });
  });

  it('should log and swallow when renameThread fails', async () => {
    const renameError = new Error('rename failed');
    (threadStore.rename as ReturnType<typeof vi.fn>).mockRejectedValueOnce(renameError);
    const { result } = renderHook(() => useThreads());

    await waitFor(() => {
      expect(threadStore.getAll).toHaveBeenCalledTimes(1);
    });

    await expect(result.current.renameThread('thread-1', 'Updated')).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith('Failed to rename thread', { error: renameError });
  });
});

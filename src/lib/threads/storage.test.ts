import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createTestStorageContext, ensureTestStorageDirectory } from '@/test/mocks/storage';
import type { Thread, Message } from './types';
import type { OperationState } from '@/lib/operations/types';

/**
 * Interface for the new file-per-thread storage API.
 * These functions will be added to storage.ts in Step 4.2-4.3.
 */
interface ThreadStorageModule {
  THREADS_STORAGE_DIR: string;
  THREADS_INDEX_FILE: string;
  readThreadIndex: () => Promise<{ version: 1; updatedAt: string; threads: Array<{ id: string; title: string; updatedAt: string }> }>;
  readThread: (threadId: string) => Promise<ThreadFile | null>;
  writeThread: (thread: Thread, operationState?: OperationState) => Promise<void>;
  BufferedThreadWriter: new (threadId: string) => {
    append: (content: string) => void;
    flush: () => Promise<void>;
    getBuffer: () => string;
  };
}

interface ThreadFile {
  metadata: {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    operationState?: OperationState;
  };
  data: Thread;
}

describe('Thread storage (file-per-thread)', () => {
  let cleanup: () => Promise<void>;
  let storageDir: string;
  let storage: ThreadStorageModule;

  beforeEach(async () => {
    vi.resetModules();
    const context = createTestStorageContext({ prefix: 'thread-storage' });
    storageDir = context.storageDir;
    cleanup = context.cleanup;
    await ensureTestStorageDirectory(storageDir);
    // Import server-only module for testing
    storage = (await import('./storage.server')) as unknown as ThreadStorageModule;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('should return default index when missing', async () => {
    const index = await storage.readThreadIndex();

    expect(index.version).toBe(1);
    expect(index.threads).toEqual([]);
  });

  it('should write thread file and update index', async () => {
    const thread: Thread = {
      id: 'thread-123',
      title: 'Learning React Hooks',
      context: { repos: [] },
      messages: [],
      createdAt: '2026-01-25T00:00:00.000Z',
      updatedAt: '2026-01-25T00:00:00.000Z',
    };

    await storage.writeThread(thread, {
      jobId: 'job-456',
      status: 'generating',
      startedAt: '2026-01-25T00:00:00.000Z',
    });

    const index = await storage.readThreadIndex();
    expect(index.threads).toEqual([
      expect.objectContaining({
        id: thread.id,
        title: thread.title,
      }),
    ]);

    const saved = await storage.readThread(thread.id);
    expect(saved).not.toBeNull();
    expect(saved?.data.id).toBe(thread.id);
    expect(saved?.metadata.operationState?.jobId).toBe('job-456');
  });

  it('should support threads with messages', async () => {
    const messages: Message[] = [
      { id: 'msg-1', role: 'user', content: 'Hello', timestamp: '2026-01-25T00:00:00.000Z' },
      { id: 'msg-2', role: 'assistant', content: 'Hi there!', timestamp: '2026-01-25T00:00:01.000Z' },
    ];
    const thread: Thread = {
      id: 'thread-with-messages',
      title: 'Test Thread',
      context: { repos: [] },
      messages,
      createdAt: '2026-01-25T00:00:00.000Z',
      updatedAt: '2026-01-25T00:00:01.000Z',
    };

    await storage.writeThread(thread);

    const saved = await storage.readThread(thread.id);
    expect(saved?.data.messages).toHaveLength(2);
    expect(saved?.data.messages[0].content).toBe('Hello');
    expect(saved?.data.messages[1].content).toBe('Hi there!');
  });
});

describe('Buffered thread writer', () => {
  let cleanup: () => Promise<void>;
  let storageDir: string;
  let storage: ThreadStorageModule;

  beforeEach(async () => {
    vi.resetModules();
    const context = createTestStorageContext({ prefix: 'thread-buffered' });
    storageDir = context.storageDir;
    cleanup = context.cleanup;
    await ensureTestStorageDirectory(storageDir);
    // Import server-only module for testing
    storage = (await import('./storage.server')) as unknown as ThreadStorageModule;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('should buffer content until flush', async () => {
    const writer = new storage.BufferedThreadWriter('thread-buffer-test');

    writer.append('Hello ');
    writer.append('world');

    expect(writer.getBuffer()).toBe('Hello world');
  });

  it('should write buffered content on flush', async () => {
    // First create the thread
    const thread: Thread = {
      id: 'thread-flush-test',
      title: 'Flush Test',
      context: { repos: [] },
      messages: [
        { id: 'msg-1', role: 'user', content: 'Start', timestamp: '2026-01-25T00:00:00.000Z' },
        { id: 'msg-2', role: 'assistant', content: '', timestamp: '2026-01-25T00:00:01.000Z' },
      ],
      createdAt: '2026-01-25T00:00:00.000Z',
      updatedAt: '2026-01-25T00:00:01.000Z',
    };
    await storage.writeThread(thread);

    // Buffer some content for the assistant message
    const writer = new storage.BufferedThreadWriter('thread-flush-test');
    writer.append('Streaming ');
    writer.append('response');
    await writer.flush();

    const saved = await storage.readThread('thread-flush-test');
    expect(saved?.data.messages[1].content).toBe('Streaming response');
  });
});

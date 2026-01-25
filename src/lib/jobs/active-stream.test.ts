import { createTestStorageContext, ensureTestStorageDirectory } from '@/test/mocks/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('active-stream storage', () => {
  let cleanup: () => Promise<void>;
  let getActiveStream: typeof import('./active-stream').getActiveStream;
  let setActiveStream: typeof import('./active-stream').setActiveStream;
  let watchActiveStream: typeof import('./active-stream').watchActiveStream;

  beforeEach(async () => {
    const context = createTestStorageContext();
    cleanup = context.cleanup;
    await ensureTestStorageDirectory(context.storageDir);
    vi.resetModules();
    const module = await import('./active-stream');
    getActiveStream = module.getActiveStream;
    setActiveStream = module.setActiveStream;
    watchActiveStream = module.watchActiveStream;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('should persist and load active stream data', async () => {
    const entry = {
      jobId: 'job-1',
      threadId: 'thread-1',
      content: 'partial content',
      status: 'streaming' as const,
      updatedAt: new Date().toISOString(),
    };

    await setActiveStream(entry);

    const loaded = await getActiveStream('job-1');

    expect(loaded).toMatchObject(entry);
  });

  it('should notify watchers with latest stream entry', async () => {
    const entry = {
      jobId: 'job-2',
      threadId: 'thread-2',
      content: 'hello',
      status: 'streaming' as const,
      updatedAt: new Date().toISOString(),
    };

    const updates: Array<string | null> = [];
    const unsubscribe = watchActiveStream('job-2', (loaded) => {
      updates.push(loaded?.content ?? null);
    });

    await setActiveStream(entry);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updates).toContain('hello');
    unsubscribe();
  });
});

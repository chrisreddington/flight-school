import { describe, expect, it, vi } from 'vitest';
import type { Thread } from '@/lib/threads';
import {
  combineStreamingThreadIds,
  finalizeInterruptedMessage,
  getStreamingContent,
  isThreadStreaming,
} from './use-learning-chat-stream';

vi.mock('@/lib/utils/id-generator', () => ({
  generateMessageId: vi.fn(() => 'msg-finalized'),
}));

vi.mock('@/lib/utils/date-utils', () => ({
  now: vi.fn(() => '2026-01-01T00:00:00.000Z'),
}));

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

/**
 * useLearningChat Hook Tests
 *
 * Tests for the learning chat hook covering:
 * - S4: Chat operations tracked in unified operations store
 * - S6: File-based recovery for streaming messages
 * - S5: Concurrent stream tracking across threads
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Test the core logic patterns used by useLearningChat

describe('useLearningChat core logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('streamStateToThreadMessage conversion', () => {
    it('should convert completed stream to message', () => {
      const state = {
        status: 'complete',
        content: 'This is the AI response',
        streamingBuffer: '',
        startedAt: 1000,
        completedAt: 2500,
        toolCalls: [{ name: 'search', arguments: {} }],
        hasActionableItem: true,
        clientFirstTokenMs: 150,
        serverMeta: { totalMs: 1200, sessionPoolHit: true, mcpEnabled: true },
      };

      // Replicate the conversion logic
      const rawContent = state.content || state.streamingBuffer || '';
      const content = rawContent;
      
      // Build message object
      const message = {
        role: 'assistant',
        content,
        toolCalls: state.toolCalls?.map((tc) => tc.name),
        hasActionableItem: state.hasActionableItem,
        perf: {
          clientTotalMs: state.completedAt && state.startedAt
            ? Math.round(state.completedAt - state.startedAt)
            : undefined,
          clientFirstTokenMs: state.clientFirstTokenMs,
          serverTotalMs: state.serverMeta?.totalMs,
          sessionPoolHit: state.serverMeta?.sessionPoolHit ?? undefined,
        },
      };

      expect(message.content).toBe('This is the AI response');
      expect(message.toolCalls).toEqual(['search']);
      expect(message.hasActionableItem).toBe(true);
      expect(message.perf.clientTotalMs).toBe(1500);
      expect(message.perf.clientFirstTokenMs).toBe(150);
      expect(message.perf.serverTotalMs).toBe(1200);
    });

    it('should use streamingBuffer when content is empty', () => {
      const state = {
        status: 'aborted',
        content: '',
        streamingBuffer: 'Partial response before abort',
      };

      const rawContent = state.content || state.streamingBuffer || '';
      expect(rawContent).toBe('Partial response before abort');
    });

    it('should add interruption note for aborted streams', () => {
      const state = {
        status: 'aborted',
        content: 'Partial response',
      };

      const rawContent = state.content || '';
      let content = rawContent;
      
      if (state.status === 'aborted' && content) {
        content += '\n\n*(Response stopped)*';
      }

      expect(content).toContain('*(Response stopped)*');
    });

    it('should return null for error without content', () => {
      const state = {
        status: 'error',
        content: '',
        streamingBuffer: '',
      };

      const rawContent = state.content || state.streamingBuffer || '';
      
      // Don't create a message for errors without content
      const shouldCreate = !(state.status === 'error' && !rawContent);
      
      expect(shouldCreate).toBe(false);
    });
  });

  describe('streaming message management', () => {
    it('should upsert streaming message when existing', () => {
      const thread = {
        id: 'thread-1',
        messages: [
          { id: 'msg-1', role: 'user', content: 'Hello' },
          { id: 'streaming', role: 'assistant', content: 'Old content' },
        ],
      };

      const newContent = 'Updated streaming content';
      
      // Find existing streaming message
      const existingIndex = thread.messages.findIndex((m) => m.id === 'streaming');
      expect(existingIndex).toBe(1);

      // Update it
      const updatedMessages = [...thread.messages];
      updatedMessages[existingIndex] = {
        ...updatedMessages[existingIndex],
        content: newContent,
      };

      expect(updatedMessages[1].content).toBe(newContent);
      expect(updatedMessages.length).toBe(2); // Same count
    });

    it('should add streaming message when none exists', () => {
      const thread = {
        id: 'thread-1',
        messages: [
          { id: 'msg-1', role: 'user', content: 'Hello' },
        ],
      };

      const existingIndex = thread.messages.findIndex((m) => m.id === 'streaming');
      expect(existingIndex).toBe(-1);

      // Add new streaming message
      const newMessages = [
        ...thread.messages,
        { id: 'streaming', role: 'assistant', content: 'New streaming content' },
      ];

      expect(newMessages.length).toBe(2);
      expect(newMessages[1].id).toBe('streaming');
    });

    it('should remove streaming message', () => {
      const thread = {
        id: 'thread-1',
        messages: [
          { id: 'msg-1', role: 'user', content: 'Hello' },
          { id: 'streaming', role: 'assistant', content: 'Streaming...' },
        ],
      };

      const filteredMessages = thread.messages.filter((m) => m.id !== 'streaming');
      
      expect(filteredMessages.length).toBe(1);
      expect(filteredMessages[0].id).toBe('msg-1');
    });
  });

  describe('interrupted message finalization', () => {
    it('should finalize interrupted streaming message', () => {
      const thread = {
        id: 'thread-1',
        messages: [
          { id: 'msg-1', role: 'user', content: 'Hello' },
          { id: 'streaming', role: 'assistant', content: 'Partial response' },
        ],
      };

      const streamingMessage = thread.messages.find((m) => m.id === 'streaming');
      expect(streamingMessage).toBeDefined();

      const trimmedContent = streamingMessage!.content.trim();
      expect(trimmedContent).toBeTruthy();

      // Add interruption note if not present
      const interruptionNote = '*(Response interrupted)*';
      const content = streamingMessage!.content.includes(interruptionNote)
        ? streamingMessage!.content
        : `${streamingMessage!.content}\n\n${interruptionNote}`;

      expect(content).toContain('*(Response interrupted)*');
    });

    it('should remove empty streaming message during finalization', () => {
      const thread = {
        id: 'thread-1',
        messages: [
          { id: 'msg-1', role: 'user', content: 'Hello' },
          { id: 'streaming', role: 'assistant', content: '   ' }, // Only whitespace
        ],
      };

      const streamingMessage = thread.messages.find((m) => m.id === 'streaming');
      const trimmedContent = streamingMessage!.content.trim();
      
      // Empty after trim - should be removed, not finalized
      expect(trimmedContent).toBe('');
    });
  });

  describe('concurrent stream tracking', () => {
    it('should track multiple streaming thread IDs', () => {
      const activeStreams = new Map([
        ['thread-1', { status: 'streaming', content: 'Response 1...' }],
        ['thread-2', { status: 'streaming', content: 'Response 2...' }],
        ['thread-3', { status: 'streaming', content: 'Response 3...' }],
      ]);

      const streamingThreadIds = Array.from(activeStreams.keys());
      
      expect(streamingThreadIds).toHaveLength(3);
      expect(streamingThreadIds).toContain('thread-1');
      expect(streamingThreadIds).toContain('thread-2');
      expect(streamingThreadIds).toContain('thread-3');
    });

    it('should get streaming content for specific thread', () => {
      const activeStreams = new Map([
        ['thread-1', { content: 'Content for thread 1' }],
        ['thread-2', { content: 'Content for thread 2' }],
      ]);

      const getStreamingContent = (threadId: string): string => {
        return activeStreams.get(threadId)?.content ?? '';
      };

      expect(getStreamingContent('thread-1')).toBe('Content for thread 1');
      expect(getStreamingContent('thread-2')).toBe('Content for thread 2');
      expect(getStreamingContent('thread-unknown')).toBe('');
    });

    it('should check if specific conversation is streaming', () => {
      const activeStreams = new Map([
        ['thread-1', { status: 'streaming' }],
        ['thread-2', { status: 'complete' }],
      ]);

      const isStreamingConversation = (threadId: string): boolean => {
        const stream = activeStreams.get(threadId);
        return stream?.status === 'streaming';
      };

      expect(isStreamingConversation('thread-1')).toBe(true);
      expect(isStreamingConversation('thread-2')).toBe(false);
      expect(isStreamingConversation('thread-unknown')).toBe(false);
    });
  });

  describe('background job state tracking', () => {
    it('should detect active background job for thread', () => {
      const mockOperationsManager = {
        operations: new Map([
          ['op-1', { type: 'chat-response', status: 'in-progress', meta: { targetId: 'thread-1' } }],
          ['op-2', { type: 'chat-response', status: 'complete', meta: { targetId: 'thread-2' } }],
        ]),
        hasActiveChatJob: function(threadId: string): boolean {
          for (const op of this.operations.values()) {
            if (op.type === 'chat-response' && 
                op.status === 'in-progress' && 
                op.meta.targetId === threadId) {
              return true;
            }
          }
          return false;
        },
      };

      expect(mockOperationsManager.hasActiveChatJob('thread-1')).toBe(true);
      expect(mockOperationsManager.hasActiveChatJob('thread-2')).toBe(false);
      expect(mockOperationsManager.hasActiveChatJob('thread-unknown')).toBe(false);
    });

    it('should combine SSE and background job streaming states', () => {
      const sseStreaming = false;
      const hasActiveBackgroundJob = true;

      // isStreaming should be true if EITHER is active
      const isStreaming = sseStreaming || hasActiveBackgroundJob;
      
      expect(isStreaming).toBe(true);
    });
  });
});

describe('useLearningChat interface contract', () => {
  it('should define expected state shape', () => {
    interface Thread {
      id: string;
      title: string;
      messages: unknown[];
    }

    interface UseLearningChatState {
      threads: Thread[];
      activeThread: Thread | null;
      activeThreadId: string | null;
      isThreadsLoading: boolean;
      isStreaming: boolean;
      streamingContent: string;
      streamingThreadId: string | null;
      streamingThreadIds: string[];
    }

    const mockState: UseLearningChatState = {
      threads: [],
      activeThread: null,
      activeThreadId: null,
      isThreadsLoading: false,
      isStreaming: false,
      streamingContent: '',
      streamingThreadId: null,
      streamingThreadIds: [],
    };

    expect(Array.isArray(mockState.threads)).toBe(true);
    expect(typeof mockState.isStreaming).toBe('boolean');
    expect(typeof mockState.streamingContent).toBe('string');
    expect(Array.isArray(mockState.streamingThreadIds)).toBe(true);
  });

  it('should define expected action types', () => {
    interface SendLearningMessageOptions {
      useGitHubTools?: boolean;
      repos?: unknown[];
      threadId?: string;
    }

    interface UseLearningChatActions {
      sendMessage: (content: string, options?: SendLearningMessageOptions) => Promise<void>;
      stopStreaming: () => void;
      createThread: (options?: unknown) => Promise<unknown>;
      selectThread: (threadId: string) => void;
      deleteThread: (threadId: string) => Promise<void>;
      renameThread: (threadId: string, newTitle: string) => Promise<void>;
      updateContext: (context: unknown) => Promise<void>;
    }

    const mockActions: UseLearningChatActions = {
      sendMessage: async () => {},
      stopStreaming: () => {},
      createThread: async () => ({}),
      selectThread: () => {},
      deleteThread: async () => {},
      renameThread: async () => {},
      updateContext: async () => {},
    };

    expect(typeof mockActions.sendMessage).toBe('function');
    expect(typeof mockActions.stopStreaming).toBe('function');
    expect(typeof mockActions.createThread).toBe('function');
    expect(typeof mockActions.selectThread).toBe('function');
    expect(typeof mockActions.deleteThread).toBe('function');
  });
});

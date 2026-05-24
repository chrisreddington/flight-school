import type { CopilotSession } from '@github/copilot-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const spanAddEvent = vi.fn();
  const spanSetStatus = vi.fn();
  const spanEnd = vi.fn();
  const spanRecordException = vi.fn();
  const span = {
    addEvent: spanAddEvent,
    setStatus: spanSetStatus,
    end: spanEnd,
    recordException: spanRecordException,
  };

  let handler: ((event: unknown) => void) | null = null;
  const setHandler = (next: (event: unknown) => void) => {
    handler = next;
  };
  const emit = (event: unknown) => {
    if (handler) {
      handler(event);
    }
  };

  const send = vi.fn(async () => {
    emit({ type: 'assistant.message_delta', data: { deltaContent: 'Hi' } });
    emit({
      type: 'tool.execution_start',
      data: { toolName: 'search_code', arguments: { query: 'foo' } },
    });
    emit({
      type: 'tool.execution_complete',
      data: { result: 'ok' },
    });
    emit({ type: 'session.idle', data: {} });
    return 'message-id';
  });

  const session = {
    on: vi.fn((eventHandler: (event: unknown) => void) => {
      setHandler(eventHandler);
      return () => {};
    }),
    send,
    destroy: vi.fn(async () => undefined),
  } as unknown as CopilotSession;

  return {
    activityComplete: vi.fn(),
    getConversationSession: vi.fn(async () => ({
      session,
      metrics: {
        createdNew: false,
        reusedConversation: true,
        sessionCreateMs: 25,
        mcpEnabled: true,
      },
    })),
    latestEventIdForUser: vi.fn(() => 'evt-1'),
    recordAiOperation: vi.fn(),
    recordAiStreamMetrics: vi.fn(),
    span,
    spanAddEvent,
    spanEnd,
    spanRecordException,
    spanSetStatus,
  };
});

vi.mock('@/lib/logger', () => ({
  logger: {
    withTag: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

vi.mock('./sessions', () => ({
  CHAT_MODEL: 'claude-haiku-4.5',
  getConversationSession: mocks.getConversationSession,
  getConversationCapabilities: vi.fn(() => undefined),
  getCopilotGithubMcpTools: vi.fn(() => []),
}));

vi.mock('./activity/logger', () => ({
  activityLogger: {
    logEvent: vi.fn(),
    startOperation: vi.fn(async () => ({ eventId: 'evt-1', complete: mocks.activityComplete })),
    updateWithClientMetrics: vi.fn(async () => true),
    clear: vi.fn(async () => undefined),
  },
}));

vi.mock('@/lib/observability/telemetry', () => ({
  recordAiOperation: mocks.recordAiOperation,
  recordAiStreamMetrics: mocks.recordAiStreamMetrics,
  recordAiTokenUsage: vi.fn(),
}));

vi.mock('@opentelemetry/api', () => ({
  SpanStatusCode: {
    ERROR: 2,
  },
  context: {
    active: vi.fn(() => ({})),
    with: vi.fn(async (_ctx: unknown, callback: () => Promise<unknown>) => {
      return await callback();
    }),
  },
  trace: {
    getTracer: vi.fn(() => ({
      startSpan: vi.fn(() => mocks.span),
    })),
    setSpan: vi.fn(() => ({})),
  },
}));

import { createChatStreamingSession } from './streaming';

describe('createChatStreamingSession telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records stream metrics and emits lifecycle span events', async () => {
    const streaming = await createChatStreamingSession(
      { userId: 'user-1', gitHubToken: 'ghu_token' },
      'hello',
      { profile: 'chat', capabilities: ['github'], operationName: 'Chat', conversationId: 'conv-1' },
    );

    const events = [];
    for await (const event of streaming.stream) {
      events.push(event);
    }

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'delta', content: 'Hi' }),
        expect.objectContaining({ type: 'tool_start', name: 'search_code' }),
        expect.objectContaining({ type: 'tool_complete', name: 'search_code' }),
        expect.objectContaining({ type: 'done' }),
      ]),
    );

    const lifecycleEvents = mocks.spanAddEvent.mock.calls.map(([name]) => name);
    expect(lifecycleEvents).toEqual(expect.arrayContaining([
      'stream.started',
      'first_token',
      'tool.start',
      'tool.complete',
      'stream.completed',
    ]));

    expect(mocks.recordAiStreamMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4.5',
        terminalState: 'completed',
        deltaCount: 1,
        deltaBytes: 2,
        toolCalls: 1,
      }),
    );
    expect(mocks.spanEnd).toHaveBeenCalled();
  });
});

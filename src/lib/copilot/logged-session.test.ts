import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CopilotSession } from '@github/copilot-sdk';
import { wrapSessionWithLogging } from './logged-session';

const mocks = vi.hoisted(() => {
  const completeOperationMock = vi.fn();
  return {
    completeOperationMock,
    logEventMock: vi.fn(),
    recordAiOperationMock: vi.fn(),
    startOperationMock: vi.fn(async () => ({ eventId: 'evt-1', complete: completeOperationMock })),
  };
});

vi.mock('./activity/logger', () => ({
  activityLogger: {
    logEvent: mocks.logEventMock,
    startOperation: mocks.startOperationMock,
  },
}));

vi.mock('@/lib/observability/telemetry', () => ({
  recordAiOperation: mocks.recordAiOperationMock,
  recordAiTokenUsage: vi.fn(),
  setSpanError: vi.fn(),
  withSpan: vi.fn((_name, _attributes, callback) => callback({})),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    withTag: vi.fn(() => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    })),
  },
}));

describe('wrapSessionWithLogging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should log tool activity and return response details', async () => {
    let eventHandler: CopilotSession['on'] extends (handler: infer T) => unknown ? T : never;
    const destroyMock = vi.fn().mockResolvedValue(undefined);
    const session = {
      on: vi.fn((handler) => {
        eventHandler = handler;
      }),
      sendAndWait: vi.fn().mockResolvedValue({ data: { content: 'Hello from Copilot' } }),
      destroy: destroyMock,
    } as unknown as CopilotSession;

    const loggedSession = wrapSessionWithLogging('u1', session, 'Chat', 'prompt', 'gpt-5-mini');

    if (!eventHandler) {
      throw new Error('Expected wrapSessionWithLogging to register a session event handler');
    }

    eventHandler({
      type: 'tool.execution_start',
      data: { toolName: 'get_me', arguments: { login: 'octo' } },
    });
    eventHandler({
      type: 'tool.execution_complete',
      data: { result: 'done' },
    });

    const result = await loggedSession.sendAndWait('hello');
    await loggedSession.destroy();

    expect(result.responseText).toBe('Hello from Copilot');
    expect(result.toolCalls).toMatchObject([{ name: 'get_me', args: { login: 'octo' }, result: 'done' }]);
    expect(mocks.startOperationMock).toHaveBeenCalledWith(
      'u1',
      'ask',
      'Chat',
      expect.objectContaining({ model: 'gpt-5-mini', prompt: 'prompt' }),
    );
    expect(mocks.logEventMock).toHaveBeenCalledWith(
      'u1',
      'tool',
      'mcp.get_me',
      expect.objectContaining({ metadata: { args: { login: 'octo' } } }),
    );
    expect(mocks.completeOperationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fullResponse: 'Hello from Copilot',
        toolsUsed: ['get_me'],
      }),
    );
    expect(mocks.recordAiOperationMock).toHaveBeenCalledWith('sendAndWait', expect.any(Number), 'gpt-5-mini', 'ok');
    expect(destroyMock).toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  CopilotClient: vi.fn(),
  wrapSessionWithLogging: vi.fn(),
  executeChatWithSessionFactory: vi.fn(),
  createSession: vi.fn(),
  stop: vi.fn(),
  forceStop: vi.fn(),
}));

vi.mock('@github/copilot-sdk', () => ({
  approveAll: vi.fn(),
  CopilotClient: mocks.CopilotClient,
}));

vi.mock('@/lib/copilot/logged-session', () => ({
  wrapSessionWithLogging: mocks.wrapSessionWithLogging,
}));

vi.mock('./session-executor', () => ({
  executeChatWithSessionFactory: mocks.executeChatWithSessionFactory,
}));

import { createCopilotUserRuntime } from './user-runtime';

describe('createCopilotUserRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSession.mockResolvedValue({ sessionId: 'session-1' });
    mocks.stop.mockResolvedValue([]);
    mocks.forceStop.mockResolvedValue(undefined);
    mocks.CopilotClient.mockImplementation(function CopilotClientMock() {
      return {
        createSession: mocks.createSession,
        stop: mocks.stop,
        forceStop: mocks.forceStop,
      };
    });
    mocks.wrapSessionWithLogging.mockReturnValue({
      sendAndWait: vi.fn(),
      destroy: vi.fn(),
      model: 'claude-haiku-4.5',
    });
    mocks.executeChatWithSessionFactory.mockResolvedValue({
      response: 'answer',
      toolCalls: [],
      meta: {
        generatedAt: '2026-05-22T18:00:00.000Z',
        model: 'claude-haiku-4.5',
        toolsUsed: [],
        totalTimeMs: 10,
        profile: 'chat',
        sessionCreateMs: null,
        sessionPoolHit: null,
        mcpEnabled: null,
        sessionReused: null,
      },
    });
  });

  it('creates a Copilot client scoped to the user token and home', async () => {
    const runtime = await createCopilotUserRuntime({
      userId: '123',
      gitHubToken: 'ghu_user',
      copilotHome: '/tmp/runtimes/123',
    });

    expect(runtime.userId).toBe('123');
    expect(runtime.copilotHome).toBe('/tmp/runtimes/123');
    expect(mocks.CopilotClient).toHaveBeenCalledWith(
      expect.objectContaining({
        gitHubToken: 'ghu_user',
        useLoggedInUser: false,
        copilotHome: '/tmp/runtimes/123',
      }),
    );
  });

  it('executes chat through the runtime client session factory', async () => {
    const runtime = await createCopilotUserRuntime({
      userId: '123',
      gitHubToken: 'ghu_user',
      copilotHome: '/tmp/runtimes/123',
    });
    const request = {
      identity: { userId: '123', gitHubToken: 'ghu_user' },
      prompt: 'hello',
      profile: 'chat' as const,
    };

    await expect(runtime.executeChat(request)).resolves.toMatchObject({ response: 'answer' });

    expect(mocks.executeChatWithSessionFactory).toHaveBeenCalledWith(request, expect.any(Function));
  });

  it('force stops the client when graceful stop reports errors', async () => {
    mocks.stop.mockResolvedValue([new Error('stop failed')]);
    const runtime = await createCopilotUserRuntime({
      userId: '123',
      gitHubToken: 'ghu_user',
      copilotHome: '/tmp/runtimes/123',
    });

    await runtime.disconnect();

    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.forceStop).toHaveBeenCalledOnce();
  });
});

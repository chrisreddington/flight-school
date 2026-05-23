import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSessionWithMetricsMock = vi.fn();
const getConversationSessionMock = vi.fn();

vi.mock('./sessions', async () => {
  const actual = await vi.importActual<typeof import('./sessions')>('./sessions');
  return {
    ...actual,
    createSessionWithMetrics: createSessionWithMetricsMock,
    getConversationSession: getConversationSessionMock,
  };
});

vi.mock('./activity/logger', () => ({
  activityLogger: {
    logEvent: vi.fn(),
    startOperation: vi.fn(() => vi.fn()),
  },
}));

vi.mock('@/lib/observability/telemetry', () => ({
  recordAiOperation: vi.fn(),
  setSpanError: vi.fn(),
  withSpan: vi.fn((_name, _attributes, callback) => callback({})),
}));

const {
  createLoggedChatSession,
  createLoggedCoachSession,
  createLoggedGitHubChatSession,
  createLoggedLightweightCoachSession,
} = await import('./server');

describe('logged Copilot session factories', () => {
  const fakeSession = {
    on: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    sendAndWait: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    createSessionWithMetricsMock.mockResolvedValue({
      session: fakeSession,
      metrics: {
        poolKey: 'pool',
        createdNew: true,
        sessionCreateMs: 1,
        mcpEnabled: false,
        model: 'model',
        reusedConversation: false,
      },
    });
    getConversationSessionMock.mockResolvedValue({
      session: fakeSession,
      metrics: {
        poolKey: 'pool',
        createdNew: true,
        sessionCreateMs: 1,
        mcpEnabled: false,
        model: 'model',
        reusedConversation: false,
      },
    });
  });

  it.each([
    ['coach', () => createLoggedCoachSession({ userId: 'u1', gitHubToken: 'ghu_1' })],
    ['lightweight coach', () => createLoggedLightweightCoachSession({ userId: 'u1', gitHubToken: 'ghu_1' })],
  ])('should pass per-request GitHub token for %s sessions', async (_name, createSession) => {
    await createSession();

    expect(createSessionWithMetricsMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', gitHubToken: 'ghu_1' }),
      expect.any(String),
    );
  });

  it.each([
    ['chat', () => createLoggedChatSession({ userId: 'u1', gitHubToken: 'ghu_1' }, 'Chat', 'prompt', 'conv-1')],
    ['GitHub chat', () => createLoggedGitHubChatSession({ userId: 'u1', gitHubToken: 'ghu_1' }, 'Chat', 'prompt', 'conv-1')],
  ])('should pass per-request GitHub token for %s sessions', async (_name, createSession) => {
    await createSession();

    expect(getConversationSessionMock).toHaveBeenCalledWith(
      'u1',
      'conv-1',
      expect.any(String),
      expect.objectContaining({ userId: 'u1', gitHubToken: 'ghu_1' }),
    );
  });

  it('creates coach sessions with MCP repository tools and the coach pool', async () => {
    await createLoggedCoachSession({ userId: 'u1', gitHubToken: 'ghu_1' }, 'Daily Focus', 'prompt');

    expect(createSessionWithMetricsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        includeMcpTools: true,
        tools: ['get_me', 'list_user_repositories'],
        userId: 'u1',
        gitHubToken: 'ghu_1',
      }),
      'coach:mcp',
    );
  });

  it('creates lightweight coach sessions without MCP tools and with the lightweight pool', async () => {
    await createLoggedLightweightCoachSession({ userId: 'u1', gitHubToken: 'ghu_1' });

    expect(createSessionWithMetricsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        includeMcpTools: false,
        model: expect.any(String),
        userId: 'u1',
        gitHubToken: 'ghu_1',
      }),
      'coach:lightweight',
    );
  });

  it('keeps single-turn chat sessions on the conversation-session path and destroys them on cleanup', async () => {
    const loggedSession = await createLoggedChatSession({ userId: 'u1', gitHubToken: 'ghu_1' }, 'Chat', 'prompt');

    expect(getConversationSessionMock).toHaveBeenCalledWith(
      'u1',
      undefined,
      'chat:lightweight',
      expect.objectContaining({
        includeMcpTools: false,
        userId: 'u1',
        gitHubToken: 'ghu_1',
      }),
    );

    await loggedSession.destroy();

    expect(fakeSession.destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps conversation chat sessions alive on wrapper cleanup', async () => {
    const loggedSession = await createLoggedGitHubChatSession(
      { userId: 'u1', gitHubToken: 'ghu_1' },
      'GitHub Chat',
      'prompt',
      'conv-1',
    );

    expect(getConversationSessionMock).toHaveBeenCalledWith(
      'u1',
      'conv-1',
      'chat:mcp',
      expect.objectContaining({
        includeMcpTools: true,
        userId: 'u1',
        gitHubToken: 'ghu_1',
      }),
    );

    await loggedSession.destroy();

    expect(fakeSession.destroy).not.toHaveBeenCalled();
  });
});

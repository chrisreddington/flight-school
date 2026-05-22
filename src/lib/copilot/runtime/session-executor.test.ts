import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeChatWithSessionFactory } from './session-executor';

const mocks = {
  sendAndWait: vi.fn(),
  destroy: vi.fn(),
  createChatSession: vi.fn(),
  createGitHubChatSession: vi.fn(),
};

describe('executeChatWithSessionFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendAndWait.mockResolvedValue({
      responseText: 'hello',
      totalTimeMs: 42,
      toolCalls: [{ name: 'get_me', args: {}, result: 'ok', startTime: 10, endTime: 15 }],
    });
    mocks.createChatSession.mockResolvedValue({
      model: 'claude-haiku-4.5',
      sessionMetrics: {
        createdNew: true,
        sessionCreateMs: 7,
        mcpEnabled: false,
        reusedConversation: false,
        poolKey: 'chat:lightweight',
        model: 'claude-haiku-4.5',
      },
      sendAndWait: mocks.sendAndWait,
      destroy: mocks.destroy,
    });
    mocks.createGitHubChatSession.mockResolvedValue({
      model: 'claude-haiku-4.5',
      sessionMetrics: {
        createdNew: false,
        sessionCreateMs: 3,
        mcpEnabled: true,
        reusedConversation: true,
        poolKey: 'chat:mcp',
        model: 'claude-haiku-4.5',
      },
      sendAndWait: mocks.sendAndWait,
      destroy: mocks.destroy,
    });
  });

  it('uses lightweight chat when GitHub tools are not requested', async () => {
    const request = {
      identity: { userId: '123', gitHubToken: 'ghu_user' },
      prompt: 'Explain closures',
      useGitHubTools: false,
      conversationId: 'thread-1',
    };

    const result = await executeChatWithSessionFactory(
      request,
      mocks.createChatSession,
      mocks.createGitHubChatSession,
    );

    expect(mocks.createChatSession).toHaveBeenCalledWith(request, 'Chat (fast)');
    expect(mocks.createGitHubChatSession).not.toHaveBeenCalled();
    expect(result.response).toBe('hello');
    expect(result.meta.usedGitHubTools).toBe(false);
    expect(result.meta.sessionPoolHit).toBe(false);
    expect(result.meta.generatedAt).toEqual(expect.any(String));
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it('uses GitHub chat when GitHub tools are requested', async () => {
    const request = {
      identity: { userId: '123', gitHubToken: 'ghu_user' },
      prompt: 'Search my repos',
      useGitHubTools: true,
      conversationId: 'thread-1',
    };

    const result = await executeChatWithSessionFactory(
      request,
      mocks.createChatSession,
      mocks.createGitHubChatSession,
    );

    expect(mocks.createGitHubChatSession).toHaveBeenCalledWith(request, 'GitHub Chat');
    expect(result.meta.usedGitHubTools).toBe(true);
    expect(result.meta.mcpEnabled).toBe(true);
    expect(result.toolCalls).toEqual([{ name: 'get_me', args: {}, result: 'ok', duration: 5 }]);
  });

  it('destroys the session when sending fails', async () => {
    mocks.sendAndWait.mockRejectedValue(new Error('send failed'));

    await expect(executeChatWithSessionFactory(
      { identity: { userId: '123', gitHubToken: 'ghu_user' }, prompt: 'Hello', useGitHubTools: false },
      mocks.createChatSession,
      mocks.createGitHubChatSession,
    )).rejects.toThrow('send failed');

    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCopilotChatInProcess } from './in-process';

const mocks = vi.hoisted(() => ({
  createLoggedChatSession: vi.fn(),
  createLoggedGitHubChatSession: vi.fn(),
  sendAndWait: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('@/lib/copilot/server', () => ({
  createLoggedChatSession: mocks.createLoggedChatSession,
  createLoggedGitHubChatSession: mocks.createLoggedGitHubChatSession,
}));

describe('executeCopilotChatInProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendAndWait.mockResolvedValue({
      responseText: 'hello',
      totalTimeMs: 42,
      toolCalls: [{ name: 'get_me', args: {}, result: 'ok', startTime: 10, endTime: 15 }],
    });
    mocks.createLoggedChatSession.mockResolvedValue({
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
    mocks.createLoggedGitHubChatSession.mockResolvedValue({
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
    const result = await executeCopilotChatInProcess({
      identity: { userId: '123', gitHubToken: 'ghu_user' },
      prompt: 'Explain closures',
      useGitHubTools: false,
      conversationId: 'thread-1',
    });

    expect(mocks.createLoggedChatSession).toHaveBeenCalledWith(
      { userId: '123', gitHubToken: 'ghu_user' },
      'Chat (fast)',
      'Explain closures',
      'thread-1',
    );
    expect(mocks.createLoggedGitHubChatSession).not.toHaveBeenCalled();
    expect(result.response).toBe('hello');
    expect(result.meta.usedGitHubTools).toBe(false);
    expect(result.meta.sessionPoolHit).toBe(false);
    expect(result.meta.generatedAt).toEqual(expect.any(String));
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it('uses GitHub chat when GitHub tools are requested', async () => {
    const result = await executeCopilotChatInProcess({
      identity: { userId: '123', gitHubToken: 'ghu_user' },
      prompt: 'Search my repos',
      useGitHubTools: true,
      conversationId: 'thread-1',
    });

    expect(mocks.createLoggedGitHubChatSession).toHaveBeenCalledWith(
      { userId: '123', gitHubToken: 'ghu_user' },
      'GitHub Chat',
      'Search my repos',
      'thread-1',
    );
    expect(result.meta.usedGitHubTools).toBe(true);
    expect(result.meta.mcpEnabled).toBe(true);
    expect(result.toolCalls).toEqual([{ name: 'get_me', args: {}, result: 'ok', duration: 5 }]);
  });

  it('destroys the session when sending fails', async () => {
    mocks.sendAndWait.mockRejectedValue(new Error('send failed'));

    await expect(executeCopilotChatInProcess({
      identity: { userId: '123', gitHubToken: 'ghu_user' },
      prompt: 'Hello',
      useGitHubTools: false,
    })).rejects.toThrow('send failed');

    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});

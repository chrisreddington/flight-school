import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeChatWithSessionFactory } from './session-executor';
import type { ResolvedProfile } from '@/lib/copilot/profiles';

const mocks = {
  sendAndWait: vi.fn(),
  destroy: vi.fn(),
  createChatSession: vi.fn(),
};

describe('executeChatWithSessionFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendAndWait.mockResolvedValue({
      responseText: 'hello',
      totalTimeMs: 42,
      toolCalls: [{ name: 'get_me', args: {}, result: 'ok', startTime: 10, endTime: 15 }],
    });
    mocks.createChatSession.mockImplementation(async (_request: unknown, resolved: ResolvedProfile) => ({
      model: resolved.model,
      sessionMetrics: {
        createdNew: resolved.profileId !== 'chat-github',
        sessionCreateMs: 7,
        mcpEnabled: resolved.capabilities.length > 0,
        reusedConversation: resolved.profileId === 'chat-github',
        poolKey: `chat:${resolved.capabilityFingerprint}`,
        model: resolved.model,
      },
      sendAndWait: mocks.sendAndWait,
      destroy: mocks.destroy,
    }));
  });

  it('resolves the chat profile when GitHub capability is not requested', async () => {
    const request = {
      identity: { userId: '123', gitHubToken: 'ghu_user' },
      prompt: 'Explain closures',
      profile: 'chat' as const,
      conversationId: 'thread-1',
    };

    const result = await executeChatWithSessionFactory(request, mocks.createChatSession);

    expect(mocks.createChatSession).toHaveBeenCalledTimes(1);
    const resolved = mocks.createChatSession.mock.calls[0][1] as ResolvedProfile;
    expect(resolved.profileId).toBe('chat');
    expect(resolved.capabilities).toHaveLength(0);
    expect(result.response).toBe('hello');
    expect(result.meta.profile).toBe('chat');
    expect(result.meta.sessionPoolHit).toBe(false);
    expect(result.meta.generatedAt).toEqual(expect.any(String));
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it('resolves the chat-github profile when GitHub capability is requested', async () => {
    const request = {
      identity: { userId: '123', gitHubToken: 'ghu_user' },
      prompt: 'Search my repos',
      profile: 'chat-github' as const,
      conversationId: 'thread-1',
    };

    const result = await executeChatWithSessionFactory(request, mocks.createChatSession);

    const resolved = mocks.createChatSession.mock.calls[0][1] as ResolvedProfile;
    expect(resolved.profileId).toBe('chat-github');
    expect(resolved.capabilities.length).toBeGreaterThan(0);
    expect(result.meta.profile).toBe('chat-github');
    expect(result.meta.mcpEnabled).toBe(true);
    expect(result.toolCalls).toEqual([{ name: 'get_me', args: {}, result: 'ok', duration: 5 }]);
  });

  it('destroys the session when sending fails', async () => {
    mocks.sendAndWait.mockRejectedValue(new Error('send failed'));

    await expect(
      executeChatWithSessionFactory(
        {
          identity: { userId: '123', gitHubToken: 'ghu_user' },
          prompt: 'Hello',
          profile: 'chat',
        },
        mocks.createChatSession,
      ),
    ).rejects.toThrow('send failed');

    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});

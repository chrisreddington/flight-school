/**
 * Tests for multitenant session caching and per-session GitHub token forwarding.
 *
 * Verifies that:
 *  - Two different users with the same conversationId get distinct sessions
 *    (no cross-user leak through the in-memory cache).
 *  - `gitHubToken` from SessionOptions is forwarded to `CopilotClient.createSession`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const createSessionMock = vi.fn();

vi.mock('@github/copilot-sdk', () => {
  class CopilotClient {
    createSession = createSessionMock;
  }
  return {
    CopilotClient,
    approveAll: vi.fn(),
  };
});

vi.mock('./mcp', () => ({
  getMcpServerConfig: vi.fn(),
}));

import { getConversationSession, createSessionWithMetrics } from './sessions';

const chatOptions = (userId: string, gitHubToken: string) => ({
  userId,
  gitHubToken,
  profile: 'chat' as const,
  capabilities: [] as const,
  systemMessage: 'system',
  model: 'claude-haiku-4.5',
});

describe('getConversationSession multitenant cache', () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    let i = 0;
    createSessionMock.mockImplementation(async () => ({ id: `session-${++i}` }));
  });

  it('does not leak sessions between users sharing a conversationId', async () => {
    const a = await getConversationSession('conv1', chatOptions('userA', 'ghu_aaa'));
    const b = await getConversationSession('conv1', chatOptions('userB', 'ghu_bbb'));

    expect(a.session).not.toBe(b.session);
    expect(createSessionMock).toHaveBeenCalledTimes(2);
  });

  it('reuses a cached session for the same user + conversationId', async () => {
    const first = await getConversationSession('conv-reuse', chatOptions('userReuse', 'ghu_aaa'));
    const second = await getConversationSession('conv-reuse', chatOptions('userReuse', 'ghu_aaa'));

    expect(second.session).toBe(first.session);
    expect(second.metrics.reusedConversation).toBe(true);
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });

  it('forwards gitHubToken to CopilotClient.createSession', async () => {
    await getConversationSession('conv-token', chatOptions('userToken', 'ghu_token_xyz'));

    expect(createSessionMock).toHaveBeenCalledTimes(1);
    const call = createSessionMock.mock.calls[0][0];
    expect(call.gitHubToken).toBe('ghu_token_xyz');
  });

  it('throws when userId is missing (multi-tenant invariant)', async () => {
    await expect(
      getConversationSession('conv-x', chatOptions('', 'ghu_x')),
    ).rejects.toThrow(/userId required for session cache key/);
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});

describe('createSessionWithMetrics gitHubToken invariant (D4)', () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    createSessionMock.mockImplementation(async () => ({ id: 'session-x' }));
  });

  it('throws when gitHubToken is an empty string', async () => {
    await expect(
      createSessionWithMetrics(chatOptions('u1', '')),
    ).rejects.toThrow(/gitHubToken is required — multi-tenant invariant/);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('throws when gitHubToken field is missing entirely', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createSessionWithMetrics({ userId: 'u1', profile: 'chat', capabilities: [], systemMessage: 's', model: 'm' } as any),
    ).rejects.toThrow(/gitHubToken is required — multi-tenant invariant/);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('throws from getConversationSession when gitHubToken is empty', async () => {
    await expect(
      getConversationSession('conv-y', chatOptions('u1', '')),
    ).rejects.toThrow(/gitHubToken is required — multi-tenant invariant/);
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});

describe('entitlement failure handling (P5)', () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    // Reset the negative cache between tests
    return import('./entitlement').then(({ clearNegativeEntitlement }) => {
      clearNegativeEntitlement();
    });
  });

  it('translates an entitlement error from the SDK into CopilotEntitlementRequiredError', async () => {
    const { CopilotEntitlementRequiredError } = await import('./entitlement');
    createSessionMock.mockRejectedValueOnce(new Error('User is not entitled to Copilot'));

    await expect(
      getConversationSession('conv-x', chatOptions('userNoLicense', 'ghu_x')),
    ).rejects.toBeInstanceOf(CopilotEntitlementRequiredError);
  });

  it('caches the negative verdict for subsequent calls (no second SDK ping)', async () => {
    const { CopilotEntitlementRequiredError } = await import('./entitlement');
    createSessionMock.mockRejectedValueOnce(new Error('No active Copilot subscription'));

    await expect(
      getConversationSession('conv-1', chatOptions('userCached', 'ghu_x')),
    ).rejects.toBeInstanceOf(CopilotEntitlementRequiredError);

    // Second call should short-circuit without invoking the SDK again.
    await expect(
      getConversationSession('conv-2', chatOptions('userCached', 'ghu_x')),
    ).rejects.toBeInstanceOf(CopilotEntitlementRequiredError);

    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });

  it('re-throws non-entitlement errors unchanged', async () => {
    const networkError = new Error('ECONNREFUSED localhost:54321');
    createSessionMock.mockRejectedValueOnce(networkError);

    await expect(
      getConversationSession('conv-net', chatOptions('userNet', 'ghu_x')),
    ).rejects.toBe(networkError);
  });
});

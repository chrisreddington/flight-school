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

import { getConversationSession } from './sessions';

describe('getConversationSession multitenant cache', () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    let i = 0;
    createSessionMock.mockImplementation(async () => ({ id: `session-${++i}` }));
  });

  it('does not leak sessions between users sharing a conversationId', async () => {
    const a = await getConversationSession('userA', 'conv1', 'pool', {
      gitHubToken: 'ghu_aaa',
      includeMcpTools: false,
    });
    const b = await getConversationSession('userB', 'conv1', 'pool', {
      gitHubToken: 'ghu_bbb',
      includeMcpTools: false,
    });

    expect(a.session).not.toBe(b.session);
    expect(createSessionMock).toHaveBeenCalledTimes(2);
  });

  it('reuses a cached session for the same user + conversationId', async () => {
    const first = await getConversationSession('userReuse', 'conv-reuse', 'pool', {
      gitHubToken: 'ghu_aaa',
      includeMcpTools: false,
    });
    const second = await getConversationSession('userReuse', 'conv-reuse', 'pool', {
      gitHubToken: 'ghu_aaa',
      includeMcpTools: false,
    });

    expect(second.session).toBe(first.session);
    expect(second.metrics.reusedConversation).toBe(true);
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });

  it('forwards gitHubToken to CopilotClient.createSession', async () => {
    await getConversationSession('userToken', 'conv-token', 'pool', {
      gitHubToken: 'ghu_token_xyz',
      includeMcpTools: false,
    });

    expect(createSessionMock).toHaveBeenCalledTimes(1);
    const call = createSessionMock.mock.calls[0][0];
    expect(call.gitHubToken).toBe('ghu_token_xyz');
  });

  it('omits gitHubToken when none supplied', async () => {
    await getConversationSession('userNoTok', 'conv-notok', 'pool', {
      includeMcpTools: false,
    });

    const call = createSessionMock.mock.calls[0][0];
    expect(call.gitHubToken).toBeUndefined();
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
      getConversationSession('userNoLicense', 'conv-x', 'pool', {
        gitHubToken: 'ghu_x',
        includeMcpTools: false,
      }),
    ).rejects.toBeInstanceOf(CopilotEntitlementRequiredError);
  });

  it('caches the negative verdict for subsequent calls (no second SDK ping)', async () => {
    const { CopilotEntitlementRequiredError } = await import('./entitlement');
    createSessionMock.mockRejectedValueOnce(new Error('No active Copilot subscription'));

    await expect(
      getConversationSession('userCached', 'conv-1', 'pool', {
        gitHubToken: 'ghu_x',
        includeMcpTools: false,
      }),
    ).rejects.toBeInstanceOf(CopilotEntitlementRequiredError);

    // Second call should short-circuit without invoking the SDK again.
    await expect(
      getConversationSession('userCached', 'conv-2', 'pool', {
        gitHubToken: 'ghu_x',
        includeMcpTools: false,
      }),
    ).rejects.toBeInstanceOf(CopilotEntitlementRequiredError);

    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });

  it('re-throws non-entitlement errors unchanged', async () => {
    const networkError = new Error('ECONNREFUSED localhost:54321');
    createSessionMock.mockRejectedValueOnce(networkError);

    await expect(
      getConversationSession('userNet', 'conv-net', 'pool', {
        gitHubToken: 'ghu_x',
        includeMcpTools: false,
      }),
    ).rejects.toBe(networkError);
  });
});

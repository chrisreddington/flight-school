/**
 * Cross-user leak integration tests.
 *
 * High-level checks that the per-request auth/token plumbing keeps users
 * fully isolated when they make concurrent requests. Individual modules
 * have their own unit tests (Octokit factory, MCP config, session cache);
 * this suite verifies the system as a whole.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSessionMock = vi.fn();
const octokitConstructorSpy = vi.fn();

vi.mock('@github/copilot-sdk', () => {
  class CopilotClient {
    createSession = createSessionMock;
  }
  return {
    CopilotClient,
    approveAll: vi.fn(),
  };
});

vi.mock('octokit', () => ({
  Octokit: vi.fn().mockImplementation(function (this: object, options: { auth: string }) {
    octokitConstructorSpy(options);
    Object.assign(this, {
      auth: options.auth,
      rest: {},
      hook: { wrap: vi.fn() },
    });
  }),
}));

vi.mock('@/lib/auth/context', () => ({
  requireUserContext: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

import { getOctokitForToken } from '@/lib/github/client';
import { getMcpServerConfig } from '@/lib/copilot/mcp';
import { getConversationSession } from '@/lib/copilot/sessions';

const TOKEN_A = 'ghu_userA_token_aaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = 'ghu_userB_token_bbbbbbbbbbbbbbbbbbbb';

describe('multi-tenant auth/token isolation', () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    octokitConstructorSpy.mockClear();
    let i = 0;
    createSessionMock.mockImplementation(async () => ({
      id: `session-${++i}`,
      destroy: vi.fn().mockResolvedValue(undefined),
    }));
  });

  describe('Octokit per-token isolation', () => {
    it('builds distinct Octokit instances for two users', () => {
      const a = getOctokitForToken(TOKEN_A);
      const b = getOctokitForToken(TOKEN_B);
      expect(a).not.toBe(b);
      expect((a as unknown as { auth: string }).auth).toBe(TOKEN_A);
      expect((b as unknown as { auth: string }).auth).toBe(TOKEN_B);
    });

    it('passes the exact per-user token to the Octokit constructor', () => {
      getOctokitForToken(TOKEN_A);
      getOctokitForToken(TOKEN_B);
      const calls = octokitConstructorSpy.mock.calls.map((c) => c[0].auth);
      expect(calls).toEqual([TOKEN_A, TOKEN_B]);
      expect(TOKEN_A).not.toBe(TOKEN_B);
    });
  });

  describe('MCP config per-token isolation', () => {
    it('embeds the supplied user token into the Authorization header', () => {
      const cfgA = getMcpServerConfig({ token: TOKEN_A });
      const cfgB = getMcpServerConfig({ token: TOKEN_B });
      expect(cfgA.headers?.Authorization).toBe(`Bearer ${TOKEN_A}`);
      expect(cfgB.headers?.Authorization).toBe(`Bearer ${TOKEN_B}`);
      expect(cfgA.headers?.Authorization).not.toBe(cfgB.headers?.Authorization);
    });

    it('returns a fresh config object per call (no shared mutable state)', () => {
      const cfg1 = getMcpServerConfig({ token: TOKEN_A });
      const cfg2 = getMcpServerConfig({ token: TOKEN_A });
      expect(cfg1).not.toBe(cfg2);
      expect(cfg1.headers).not.toBe(cfg2.headers);
    });

    it('rejects calls without a token', () => {
      expect(() => getMcpServerConfig({ token: '' })).toThrow();
    });
  });

  describe('Copilot conversation cache per-user isolation', () => {
    it('does not share sessions across users for the same poolKey + conversationId', async () => {
      const a = await getConversationSession('userA', 'shared-conv', 'pool', {
        gitHubToken: TOKEN_A,
        includeMcpTools: false,
      });
      const b = await getConversationSession('userB', 'shared-conv', 'pool', {
        gitHubToken: TOKEN_B,
        includeMcpTools: false,
      });

      expect(a.session).not.toBe(b.session);
      expect(createSessionMock).toHaveBeenCalledTimes(2);
      const tokens = createSessionMock.mock.calls.map((c) => c[0].gitHubToken);
      expect(tokens).toEqual([TOKEN_A, TOKEN_B]);
    });

    it('handles concurrent requests from two users without crossing tokens', async () => {
      const [a, b] = await Promise.all([
        getConversationSession('userA', 'conv-A', 'pool', {
          gitHubToken: TOKEN_A,
          includeMcpTools: false,
        }),
        getConversationSession('userB', 'conv-B', 'pool', {
          gitHubToken: TOKEN_B,
          includeMcpTools: false,
        }),
      ]);

      expect(a.session).not.toBe(b.session);
      const tokens = createSessionMock.mock.calls.map((c) => c[0].gitHubToken).sort();
      expect(tokens).toEqual([TOKEN_A, TOKEN_B].sort());
    });

    it('still hits the cache for the same user + conversation on a follow-up turn', async () => {
      const first = await getConversationSession('userA', 'multi-turn', 'pool', {
        gitHubToken: TOKEN_A,
        includeMcpTools: false,
      });
      const second = await getConversationSession('userA', 'multi-turn', 'pool', {
        gitHubToken: TOKEN_A,
        includeMcpTools: false,
      });
      expect(second.session).toBe(first.session);
      expect(second.metrics.reusedConversation).toBe(true);
      expect(createSessionMock).toHaveBeenCalledTimes(1);
    });
  });
});

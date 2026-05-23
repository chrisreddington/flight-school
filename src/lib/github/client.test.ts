/**
 * Tests for the GitHub client.
 *
 * In the multi-tenant runtime there is no ambient token resolution. The
 * client exposes only:
 *  - `getOctokitForToken(token)` — per-request Octokit factory
 *  - `getOctokitForRequest()` — pulls the token from the Auth.js session
 *
 * These tests pin the factory's per-token isolation guarantees so user
 * credentials cannot leak between sessions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const octokitConstructorSpy = vi.fn();

vi.mock('@/lib/auth/context', () => ({
  requireUserContext: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

vi.mock('octokit', () => {
  return {
    Octokit: vi.fn().mockImplementation(function (this: object, options: { auth: string }) {
      octokitConstructorSpy(options);
      Object.assign(this, {
        auth: options.auth,
        rest: {},
        hook: { wrap: vi.fn() },
      });
    }),
  };
});

import * as clientModule from './client';
import { getOctokitForRequest, getOctokitForToken } from './client';
import { requireUserContext } from '@/lib/auth/context';

describe('getOctokitForToken', () => {
  beforeEach(() => {
    octokitConstructorSpy.mockClear();
  });

  it('constructs a fresh Octokit bound to the provided token', () => {
    const octokit = getOctokitForToken('ghu_tokenA');
    expect(octokit).toBeDefined();
    expect(octokitConstructorSpy).toHaveBeenCalledTimes(1);
    expect(octokitConstructorSpy).toHaveBeenCalledWith({ auth: 'ghu_tokenA' });
  });

  it('returns distinct Octokit instances for distinct tokens (no cross-user leak)', () => {
    const first = getOctokitForToken('ghu_tokenA');
    const second = getOctokitForToken('ghu_tokenB');

    expect(first).not.toBe(second);
    expect(octokitConstructorSpy).toHaveBeenCalledTimes(2);
    expect(octokitConstructorSpy).toHaveBeenNthCalledWith(1, { auth: 'ghu_tokenA' });
    expect(octokitConstructorSpy).toHaveBeenNthCalledWith(2, { auth: 'ghu_tokenB' });
  });

  it('does not cache instances even for the same token (request-scoped)', () => {
    const first = getOctokitForToken('ghu_sameToken');
    const second = getOctokitForToken('ghu_sameToken');

    expect(first).not.toBe(second);
    expect(octokitConstructorSpy).toHaveBeenCalledTimes(2);
  });
});

describe('getOctokitForRequest', () => {
  beforeEach(() => {
    octokitConstructorSpy.mockClear();
    vi.mocked(requireUserContext).mockReset();
  });

  it('uses the access token from the authenticated user context', async () => {
    vi.mocked(requireUserContext).mockResolvedValue({
      userId: '42',
      login: 'octocat',
      accessToken: 'ghu_session_token',
    });

    const octokit = await getOctokitForRequest();

    expect(octokit).toBeDefined();
    expect(octokitConstructorSpy).toHaveBeenCalledWith({ auth: 'ghu_session_token' });
  });

  it('propagates UnauthorizedError when no session is present', async () => {
    class UnauthorizedError extends Error {}
    vi.mocked(requireUserContext).mockRejectedValue(new UnauthorizedError('no session'));

    await expect(getOctokitForRequest()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(octokitConstructorSpy).not.toHaveBeenCalled();
  });
});

describe('no ambient auth surface', () => {
  it('does not export legacy token resolvers', () => {
    const exported = clientModule as Record<string, unknown>;
    expect(exported.getGitHubToken).toBeUndefined();
    expect(exported.getTokenFromGhCli).toBeUndefined();
    expect(exported.isGitHubConfigured).toBeUndefined();
    expect(exported.getAuthMethod).toBeUndefined();
    expect(exported.invalidateTokenCache).toBeUndefined();
  });
});

/**
 * Tests for the GitHub client.
 *
 * The new API exposes `getOctokitForToken(token)` for per-request Octokit
 * construction. There is no shared singleton — different tokens must produce
 * distinct Octokit instances so user credentials never leak between sessions.
 *
 * Legacy env-based helpers (`getGitHubToken`, `isGitHubConfigured`) remain for
 * boot-time / instrumentation paths and are exercised here only for the gh CLI
 * production guard.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import {
  getGitHubToken,
  getOctokitForToken,
  invalidateTokenCache,
} from './client';

/** Whether we can write to GITHUB_TOKEN in this environment. */
const canMockGithubToken = (() => {
  const backup = process.env.GITHUB_TOKEN;
  try {
    process.env.GITHUB_TOKEN = '__vitest_canary__';
    const writable = process.env.GITHUB_TOKEN === '__vitest_canary__';
    if (backup !== undefined) {
      process.env.GITHUB_TOKEN = backup;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
    return writable;
  } catch {
    return false;
  }
})();

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

describe.skipIf(!canMockGithubToken)('getGitHubToken (legacy boot-time helper)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    invalidateTokenCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    invalidateTokenCache();
  });

  it('returns GITHUB_TOKEN when set', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_test_token_123');
    const token = await getGitHubToken();
    expect(token).toBe('ghp_test_token_123');
  });

  it.each([
    ['ghp_personaltoken123', 'PAT'],
    ['gho_oauthtoken123456', 'OAuth'],
    ['ghs_servertoken12345', 'Server'],
    ['ghu_usertoken1234567', 'User'],
    ['github_pat_longertoken', 'Fine-grained PAT'],
  ])('returns %s token format (%s)', async (token) => {
    vi.stubEnv('GITHUB_TOKEN', token);
    const result = await getGitHubToken();
    expect(result).toBe(token);
  });
});

describe('gh CLI fallback guard', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    invalidateTokenCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    invalidateTokenCache();
    vi.restoreAllMocks();
  });

  it('returns null without invoking execFile when NODE_ENV=production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('GITHUB_TOKEN', '');

    const start = Date.now();
    const token = await getGitHubToken();
    const elapsed = Date.now() - start;

    expect(token).toBeNull();
    expect(elapsed).toBeLessThan(500);
  });

  it('returns null without invoking execFile when ACA_DEPLOYMENT=true', async () => {
    vi.stubEnv('ACA_DEPLOYMENT', 'true');
    vi.stubEnv('GITHUB_TOKEN', '');

    const start = Date.now();
    const token = await getGitHubToken();
    const elapsed = Date.now() - start;

    expect(token).toBeNull();
    expect(elapsed).toBeLessThan(500);
  });
});

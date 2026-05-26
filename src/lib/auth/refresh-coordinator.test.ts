/**
 * Tests for the per-userId refresh coordinator.
 *
 * Verifies the two layers of protection against the GitHub
 * refresh-token-rotation race:
 *
 * 1. **Coalescing** — concurrent calls for the same user share one
 *    in-flight Promise; GitHub is hit exactly once.
 * 2. **Store-first fallback** — a request that arrives after the burst
 *    has settled, still holding the rotated (now-invalid) refresh token
 *    on its JWT cookie, reads the store and returns the already-rotated
 *    credential instead of re-redeeming.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getTokenMock, setTokenIfNewerMock, refreshMock } = vi.hoisted(() => ({
  getTokenMock: vi.fn(),
  setTokenIfNewerMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('./token-store', () => ({
  getTokenStore: () => ({
    getToken: getTokenMock,
    setToken: vi.fn(),
    setTokenIfNewer: setTokenIfNewerMock,
    deleteToken: vi.fn(),
    cleanupExpired: vi.fn(),
  }),
}));

vi.mock('./github-oauth', () => ({
  refreshGitHubAccessToken: refreshMock,
}));

import { __resetRefreshCoordinatorForTests, refreshGitHubTokenForUser } from './refresh-coordinator';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('refreshGitHubTokenForUser', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    __resetRefreshCoordinatorForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    getTokenMock.mockReset();
    setTokenIfNewerMock.mockReset();
    refreshMock.mockReset();
  });

  it('coalesces concurrent calls for the same user into a single GitHub exchange', async () => {
    // The store has no newer record, so layer 2 falls through to a real refresh.
    getTokenMock.mockResolvedValue({
      accessToken: 'ghu_old',
      refreshToken: 'ghr_old',
      expiresAt: Math.floor(Date.now() / 1000) + 30,
    });
    const gate = deferred<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
      scope: string;
    }>();
    refreshMock.mockReturnValue(gate.promise);
    setTokenIfNewerMock.mockResolvedValue(true);

    const a = refreshGitHubTokenForUser('user-1', 'ghr_old');
    const b = refreshGitHubTokenForUser('user-1', 'ghr_old');
    const c = refreshGitHubTokenForUser('user-1', 'ghr_old');

    // Let layer-2 reads schedule.
    await Promise.resolve();
    await Promise.resolve();

    gate.resolve({
      access_token: 'ghu_new',
      refresh_token: 'ghr_new',
      expires_in: 8 * 60 * 60,
      token_type: 'bearer',
      scope: 'read:user',
    });

    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(ra.accessToken).toBe('ghu_new');
    expect(rb.accessToken).toBe('ghu_new');
    expect(rc.accessToken).toBe('ghu_new');
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(setTokenIfNewerMock).toHaveBeenCalledTimes(1);
  });

  it('returns the store record when the refresh token has already been rotated', async () => {
    // Simulates the "straggler" case: an earlier round already redeemed
    // 'ghr_old' and wrote a new credential to the store. Our caller still
    // holds 'ghr_old' on its JWT cookie.
    getTokenMock.mockResolvedValue({
      accessToken: 'ghu_already_new',
      refreshToken: 'ghr_already_new',
      expiresAt: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
    });

    const result = await refreshGitHubTokenForUser('user-1', 'ghr_old');

    expect(result.accessToken).toBe('ghu_already_new');
    expect(result.refreshToken).toBe('ghr_already_new');
    expect(refreshMock).not.toHaveBeenCalled();
    expect(setTokenIfNewerMock).not.toHaveBeenCalled();
  });

  it('does not coalesce calls for different users', async () => {
    getTokenMock.mockResolvedValue(null);
    refreshMock.mockImplementation(async (rt: string) => ({
      access_token: `ghu_${rt}`,
      refresh_token: `ghr_${rt}_next`,
      expires_in: 8 * 60 * 60,
      token_type: 'bearer',
      scope: 'read:user',
    }));
    setTokenIfNewerMock.mockResolvedValue(true);

    const [a, b] = await Promise.all([
      refreshGitHubTokenForUser('user-a', 'ghr_a'),
      refreshGitHubTokenForUser('user-b', 'ghr_b'),
    ]);

    expect(a.accessToken).toBe('ghu_ghr_a');
    expect(b.accessToken).toBe('ghu_ghr_b');
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it('clears the in-flight entry on refresh failure so subsequent calls can retry', async () => {
    getTokenMock.mockResolvedValue({
      accessToken: 'ghu_old',
      refreshToken: 'ghr_old',
      expiresAt: Math.floor(Date.now() / 1000) + 30,
    });
    refreshMock.mockRejectedValueOnce(new Error('GitHub token refresh failed: HTTP 503'));

    await expect(refreshGitHubTokenForUser('user-1', 'ghr_old')).rejects.toThrow('HTTP 503');

    // Second call: store still has the old record; refresh succeeds this time.
    refreshMock.mockResolvedValueOnce({
      access_token: 'ghu_new',
      refresh_token: 'ghr_new',
      expires_in: 8 * 60 * 60,
      token_type: 'bearer',
      scope: 'read:user',
    });
    setTokenIfNewerMock.mockResolvedValue(true);

    const result = await refreshGitHubTokenForUser('user-1', 'ghr_old');
    expect(result.accessToken).toBe('ghu_new');
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it('preserves the caller refresh token when GitHub does not rotate it', async () => {
    getTokenMock.mockResolvedValue(null);
    refreshMock.mockResolvedValue({
      access_token: 'ghu_new',
      refresh_token: undefined as unknown as string,
      expires_in: 8 * 60 * 60,
      token_type: 'bearer',
      scope: 'read:user',
    });
    setTokenIfNewerMock.mockResolvedValue(true);

    const result = await refreshGitHubTokenForUser('user-1', 'ghr_existing');

    expect(result.refreshToken).toBe('ghr_existing');
    expect(setTokenIfNewerMock.mock.calls[0][1].refreshToken).toBe('ghr_existing');
  });

  it('persists the new credential via setTokenIfNewer after a real refresh', async () => {
    getTokenMock.mockResolvedValue(null);
    refreshMock.mockResolvedValue({
      access_token: 'ghu_new',
      refresh_token: 'ghr_new',
      expires_in: 8 * 60 * 60,
      token_type: 'bearer',
      scope: 'read:user',
    });
    setTokenIfNewerMock.mockResolvedValue(true);

    await refreshGitHubTokenForUser('user-1', 'ghr_old');

    expect(setTokenIfNewerMock).toHaveBeenCalledTimes(1);
    const [userId, stored] = setTokenIfNewerMock.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(stored.accessToken).toBe('ghu_new');
    expect(stored.refreshToken).toBe('ghr_new');
    expect(stored.expiresAt).toBe(Math.floor(Date.now() / 1000) + 8 * 60 * 60);
  });
});

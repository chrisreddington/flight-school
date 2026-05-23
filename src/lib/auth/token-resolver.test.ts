/**
 * Tests for resolveFreshGitHubToken.
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

import { REFRESH_LEEWAY_MS, resolveFreshGitHubToken } from './token-resolver';

describe('resolveFreshGitHubToken', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    getTokenMock.mockReset();
    setTokenIfNewerMock.mockReset();
    refreshMock.mockReset();
  });

  it('returns null when no token is stored for the user', async () => {
    getTokenMock.mockResolvedValue(null);
    await expect(resolveFreshGitHubToken('user-1')).resolves.toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(setTokenIfNewerMock).not.toHaveBeenCalled();
  });

  it('returns the stored access token when not near expiry', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    getTokenMock.mockResolvedValue({
      accessToken: 'ghu_fresh',
      refreshToken: 'ghr_x',
      // Well past the leeway window — 1 hour out.
      expiresAt: nowSec + 60 * 60,
    });

    await expect(resolveFreshGitHubToken('user-1')).resolves.toBe('ghu_fresh');
    expect(refreshMock).not.toHaveBeenCalled();
    expect(setTokenIfNewerMock).not.toHaveBeenCalled();
  });

  it('refreshes and persists when stored token is within the leeway window', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    getTokenMock.mockResolvedValue({
      accessToken: 'ghu_stale',
      refreshToken: 'ghr_old',
      // Inside the leeway window: expires in 30s, leeway is 5min.
      expiresAt: nowSec + 30,
    });
    refreshMock.mockResolvedValue({
      access_token: 'ghu_new',
      refresh_token: 'ghr_new',
      expires_in: 8 * 60 * 60,
      token_type: 'bearer',
      scope: 'read:user',
    });

    const result = await resolveFreshGitHubToken('user-1');
    expect(result).toBe('ghu_new');
    expect(refreshMock).toHaveBeenCalledWith('ghr_old');
    expect(setTokenIfNewerMock).toHaveBeenCalledTimes(1);
    const [persistedUserId, persistedToken] = setTokenIfNewerMock.mock.calls[0];
    expect(persistedUserId).toBe('user-1');
    expect(persistedToken.accessToken).toBe('ghu_new');
    expect(persistedToken.refreshToken).toBe('ghr_new');
    expect(persistedToken.expiresAt).toBe(Math.floor(Date.now() / 1000) + 8 * 60 * 60);
  });

  it('refreshes when the token has already expired', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    getTokenMock.mockResolvedValue({
      accessToken: 'ghu_stale',
      refreshToken: 'ghr_old',
      expiresAt: nowSec - 10,
    });
    refreshMock.mockResolvedValue({
      access_token: 'ghu_new',
      refresh_token: 'ghr_new',
      expires_in: 8 * 60 * 60,
      token_type: 'bearer',
      scope: 'read:user',
    });

    await expect(resolveFreshGitHubToken('user-1')).resolves.toBe('ghu_new');
  });

  it('falls back to the existing refresh token if GitHub does not rotate it', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    getTokenMock.mockResolvedValue({
      accessToken: 'ghu_stale',
      refreshToken: 'ghr_existing',
      expiresAt: nowSec + 30,
    });
    refreshMock.mockResolvedValue({
      access_token: 'ghu_new',
      // No refresh_token in response.
      refresh_token: undefined as unknown as string,
      expires_in: 8 * 60 * 60,
      token_type: 'bearer',
      scope: 'read:user',
    });

    await resolveFreshGitHubToken('user-1');
    expect(setTokenIfNewerMock.mock.calls[0][1].refreshToken).toBe('ghr_existing');
  });

  it('throws when the refresh exchange fails', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    getTokenMock.mockResolvedValue({
      accessToken: 'ghu_stale',
      refreshToken: 'ghr_old',
      expiresAt: nowSec + 30,
    });
    refreshMock.mockRejectedValue(new Error('GitHub token refresh failed: HTTP 401'));

    await expect(resolveFreshGitHubToken('user-1')).rejects.toThrow('HTTP 401');
    expect(setTokenIfNewerMock).not.toHaveBeenCalled();
  });

  it('throws when stored token needs refresh but no refresh token is available', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    getTokenMock.mockResolvedValue({
      accessToken: 'ghu_stale',
      refreshToken: undefined,
      expiresAt: nowSec + 30,
    });

    await expect(resolveFreshGitHubToken('user-1')).rejects.toThrow(/no refresh token/i);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('exports a sane REFRESH_LEEWAY_MS', () => {
    expect(REFRESH_LEEWAY_MS).toBeGreaterThan(0);
    expect(REFRESH_LEEWAY_MS).toBeLessThan(60 * 60 * 1000);
  });
});

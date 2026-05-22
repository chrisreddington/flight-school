import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedTokenStoreFromJwt } from './seed';

const { setTokenIfNewerMock, readCredentialsFromJwtMock } = vi.hoisted(() => ({
  setTokenIfNewerMock: vi.fn<(userId: string, token: unknown) => Promise<boolean>>(),
  readCredentialsFromJwtMock: vi.fn(),
}));

vi.mock('./token-store', () => ({
  getTokenStore: () => ({
    setTokenIfNewer: setTokenIfNewerMock,
    // The interface requires these but seed.ts never calls them.
    setToken: vi.fn(),
    getToken: vi.fn(),
    deleteToken: vi.fn(),
    cleanupExpired: vi.fn(),
  }),
}));

vi.mock('./context', () => ({
  readCredentialsFromJwt: readCredentialsFromJwtMock,
}));

describe('seedTokenStoreFromJwt', () => {
  beforeEach(() => {
    setTokenIfNewerMock.mockReset();
    readCredentialsFromJwtMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns skipped-no-expiry when no JWT credentials are available', async () => {
    readCredentialsFromJwtMock.mockResolvedValue(null);
    const result = await seedTokenStoreFromJwt('user-1');
    expect(result).toEqual({ status: 'skipped-no-expiry' });
    expect(setTokenIfNewerMock).not.toHaveBeenCalled();
  });

  it('returns skipped-no-expiry when JWT carries no expiresAt', async () => {
    readCredentialsFromJwtMock.mockResolvedValue({
      accessToken: 'ghu_a',
      refreshToken: 'ghr_a',
      expiresAt: undefined,
    });
    const result = await seedTokenStoreFromJwt('user-1');
    expect(result).toEqual({ status: 'skipped-no-expiry' });
    expect(setTokenIfNewerMock).not.toHaveBeenCalled();
  });

  it('returns skipped-no-expiry when expiresAt is 0 (legacy sentinel)', async () => {
    readCredentialsFromJwtMock.mockResolvedValue({
      accessToken: 'ghu_a',
      refreshToken: 'ghr_a',
      expiresAt: 0,
    });
    const result = await seedTokenStoreFromJwt('user-1');
    expect(result).toEqual({ status: 'skipped-no-expiry' });
    expect(setTokenIfNewerMock).not.toHaveBeenCalled();
  });

  it('returns ok when CAS write succeeds', async () => {
    readCredentialsFromJwtMock.mockResolvedValue({
      accessToken: 'ghu_a',
      refreshToken: 'ghr_a',
      expiresAt: 1_700_000_000,
    });
    setTokenIfNewerMock.mockResolvedValue(true);

    const result = await seedTokenStoreFromJwt('user-1');

    expect(result).toEqual({ status: 'ok' });
    expect(setTokenIfNewerMock).toHaveBeenCalledWith('user-1', {
      accessToken: 'ghu_a',
      refreshToken: 'ghr_a',
      expiresAt: 1_700_000_000,
    });
  });

  it('returns skipped-newer-exists when CAS reports a newer winner', async () => {
    readCredentialsFromJwtMock.mockResolvedValue({
      accessToken: 'ghu_a',
      refreshToken: 'ghr_a',
      expiresAt: 1_700_000_000,
    });
    setTokenIfNewerMock.mockResolvedValue(false);

    const result = await seedTokenStoreFromJwt('user-1');

    expect(result).toEqual({ status: 'skipped-newer-exists' });
  });

  it('returns error when the store write throws', async () => {
    readCredentialsFromJwtMock.mockResolvedValue({
      accessToken: 'ghu_a',
      refreshToken: 'ghr_a',
      expiresAt: 1_700_000_000,
    });
    const boom = new Error('cosmos unreachable');
    setTokenIfNewerMock.mockRejectedValue(boom);

    const result = await seedTokenStoreFromJwt('user-1');

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error).toBe(boom);
    }
  });

  it('forwards a missing refreshToken as undefined (still seeds the access token)', async () => {
    readCredentialsFromJwtMock.mockResolvedValue({
      accessToken: 'ghu_a',
      refreshToken: undefined,
      expiresAt: 1_700_000_000,
    });
    setTokenIfNewerMock.mockResolvedValue(true);

    const result = await seedTokenStoreFromJwt('user-1');

    expect(result).toEqual({ status: 'ok' });
    expect(setTokenIfNewerMock).toHaveBeenCalledWith('user-1', {
      accessToken: 'ghu_a',
      refreshToken: undefined,
      expiresAt: 1_700_000_000,
    });
  });
});

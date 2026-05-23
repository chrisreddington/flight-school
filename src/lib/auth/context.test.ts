/**
 * Tests for getUserContext / requireUserContext.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock, getTokenMock, headersMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getTokenMock: vi.fn(),
  headersMock: vi.fn(),
}));
vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));
vi.mock('next-auth/jwt', () => ({
  getToken: getTokenMock,
}));
vi.mock('next/headers', () => ({
  headers: headersMock,
}));

import { UnauthorizedError, getUserContext, requireUserContext } from './context';

const ORIGINAL_SECRET = process.env.AUTH_SECRET;

describe('getUserContext', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = 'test-secret';
    headersMock.mockResolvedValue(new Headers({ cookie: 'authjs.session-token=opaque' }));
  });

  afterEach(() => {
    authMock.mockReset();
    getTokenMock.mockReset();
    headersMock.mockReset();
    if (ORIGINAL_SECRET === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = ORIGINAL_SECRET;
  });

  it('returns null when there is no session', async () => {
    authMock.mockResolvedValue(null);
    await expect(getUserContext()).resolves.toBeNull();
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it('returns null when the session carries a refresh error', async () => {
    authMock.mockResolvedValue({
      error: 'RefreshAccessTokenError',
      login: 'octocat',
      user: { id: '1' },
    });
    await expect(getUserContext()).resolves.toBeNull();
    // Do not even try to read the JWT when session is invalid.
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it('returns null when required session fields are missing', async () => {
    authMock.mockResolvedValue({ user: { id: '1' } });
    await expect(getUserContext()).resolves.toBeNull();
  });

  it('returns null when no access token is present in the raw JWT', async () => {
    authMock.mockResolvedValue({ login: 'octocat', user: { id: '42' } });
    getTokenMock.mockResolvedValue(null);
    await expect(getUserContext()).resolves.toBeNull();
  });

  it('returns the user context when session + raw JWT both validate', async () => {
    authMock.mockResolvedValue({ login: 'octocat', user: { id: '42' } });
    getTokenMock.mockResolvedValue({ accessToken: 'ghu_abc' });
    await expect(getUserContext()).resolves.toEqual({
      userId: '42',
      login: 'octocat',
      accessToken: 'ghu_abc',
    });
    // The access token must be read from the raw JWT, not session.
    expect(getTokenMock).toHaveBeenCalledTimes(1);
    const [params] = getTokenMock.mock.calls[0];
    expect(params.secret).toBe('test-secret');
  });

  it('returns null (not throws) when AUTH_SECRET is missing', async () => {
    // Production fails fast at boot via middleware; this is the defence
    // for tests / misconfigured contexts.
    delete process.env.AUTH_SECRET;
    authMock.mockResolvedValue({ login: 'octocat', user: { id: '42' } });
    await expect(getUserContext()).resolves.toBeNull();
  });
});

describe('requireUserContext', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = 'test-secret';
    headersMock.mockResolvedValue(new Headers({ cookie: 'authjs.session-token=opaque' }));
  });

  afterEach(() => {
    authMock.mockReset();
    getTokenMock.mockReset();
    headersMock.mockReset();
    if (ORIGINAL_SECRET === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = ORIGINAL_SECRET;
  });

  it('throws UnauthorizedError when no session is present', async () => {
    authMock.mockResolvedValue(null);
    await expect(requireUserContext()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('returns context when the session + JWT are valid', async () => {
    authMock.mockResolvedValue({ login: 'octocat', user: { id: '42' } });
    getTokenMock.mockResolvedValue({ accessToken: 'ghu_abc' });
    await expect(requireUserContext()).resolves.toEqual({
      userId: '42',
      login: 'octocat',
      accessToken: 'ghu_abc',
    });
  });
});

/**
 * Tests for getUserContext / requireUserContext.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

import { UnauthorizedError, getUserContext, requireUserContext } from './context';

describe('getUserContext', () => {
  afterEach(() => {
    authMock.mockReset();
  });

  it('returns null when there is no session', async () => {
    authMock.mockResolvedValue(null);
    await expect(getUserContext()).resolves.toBeNull();
  });

  it('returns null when the session carries a refresh error', async () => {
    authMock.mockResolvedValue({
      error: 'RefreshAccessTokenError',
      accessToken: 'ghu_x',
      login: 'octocat',
      user: { id: '1' },
    });
    await expect(getUserContext()).resolves.toBeNull();
  });

  it('returns null when required fields are missing', async () => {
    authMock.mockResolvedValue({ user: { id: '1' }, accessToken: 'ghu_x' });
    await expect(getUserContext()).resolves.toBeNull();
  });

  it('returns the user context when the session is complete', async () => {
    authMock.mockResolvedValue({
      accessToken: 'ghu_abc',
      login: 'octocat',
      user: { id: '42' },
    });
    await expect(getUserContext()).resolves.toEqual({
      userId: '42',
      login: 'octocat',
      accessToken: 'ghu_abc',
    });
  });
});

describe('requireUserContext', () => {
  afterEach(() => {
    authMock.mockReset();
  });

  it('throws UnauthorizedError when no session is present', async () => {
    authMock.mockResolvedValue(null);
    await expect(requireUserContext()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('returns context when the session is valid', async () => {
    authMock.mockResolvedValue({
      accessToken: 'ghu_abc',
      login: 'octocat',
      user: { id: '42' },
    });
    await expect(requireUserContext()).resolves.toEqual({
      userId: '42',
      login: 'octocat',
      accessToken: 'ghu_abc',
    });
  });
});

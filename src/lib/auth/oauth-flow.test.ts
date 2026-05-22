/**
 * OAuth callback / JWT refresh flow tests.
 *
 * Verifies the Auth.js `jwt` callback exported from `src/lib/auth/config.ts`:
 *  - On first sign-in (`account` present), persists access/refresh/expiry on token.
 *  - On subsequent calls with a still-valid token, returns the token unchanged.
 *  - On expiry, calls GitHub's token endpoint to refresh and updates the token.
 *  - On refresh failure, returns an error marker so the session is invalidated.
 *  - On missing refresh token at expiry, returns RefreshTokenMissing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock next-auth so importing the config doesn't actually wire up an app.
vi.mock('next-auth', () => ({
  default: vi.fn(() => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}));

vi.mock('next-auth/providers/github', () => ({
  default: vi.fn(() => ({ id: 'github', name: 'GitHub' })),
}));

import { authConfig } from '@/lib/auth/config';

type JWT = Record<string, unknown>;

interface JwtParams {
  token: JWT;
  account?: unknown;
  profile?: unknown;
}

const jwtCallback = authConfig.callbacks?.jwt as
  | ((p: JwtParams) => Promise<JWT>)
  | undefined;

interface SessionParams {
  session: Record<string, unknown> & { user?: Record<string, unknown> };
  token: JWT;
}

const sessionCallback = authConfig.callbacks?.session as
  | ((p: SessionParams) => Promise<SessionParams['session']>)
  | undefined;

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ID = process.env.AUTH_GITHUB_ID;
const ORIGINAL_SECRET = process.env.AUTH_GITHUB_SECRET;

describe('Auth.js jwt callback', () => {
  beforeEach(() => {
    process.env.AUTH_GITHUB_ID = 'client_id_xyz';
    process.env.AUTH_GITHUB_SECRET = 'client_secret_xyz';
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_ID === undefined) delete process.env.AUTH_GITHUB_ID;
    else process.env.AUTH_GITHUB_ID = ORIGINAL_ID;
    if (ORIGINAL_SECRET === undefined) delete process.env.AUTH_GITHUB_SECRET;
    else process.env.AUTH_GITHUB_SECRET = ORIGINAL_SECRET;
  });

  it('exposes a jwt callback', () => {
    expect(typeof jwtCallback).toBe('function');
  });

  it('persists access/refresh tokens and expiry on first sign-in', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const account = {
      access_token: 'ghu_initial_access',
      refresh_token: 'ghr_initial_refresh',
      expires_at: nowSec + 28_800, // 8h
    };
    const profile = { id: 12345, login: 'octocat' };

    const result = await jwtCallback!({ token: {}, account, profile });

    expect(result.accessToken).toBe('ghu_initial_access');
    expect(result.refreshToken).toBe('ghr_initial_refresh');
    expect(result.expiresAt).toBe(nowSec + 28_800);
    expect(result.userId).toBe('12345');
    expect(result.login).toBe('octocat');
  });

  it('falls back to expires_in when expires_at is missing', async () => {
    const account = {
      access_token: 'ghu_a',
      refresh_token: 'ghr_a',
      expires_in: 1000,
    };
    const result = await jwtCallback!({ token: {}, account });
    const nowSec = Math.floor(Date.now() / 1000);
    expect((result.expiresAt as number) - nowSec).toBeGreaterThanOrEqual(999);
    expect((result.expiresAt as number) - nowSec).toBeLessThanOrEqual(1001);
  });

  it('returns the token unchanged when it is still valid', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const token: JWT = {
      accessToken: 'ghu_still_valid',
      refreshToken: 'ghr_x',
      expiresAt: nowSec + 7200, // 2h in the future
    };
    const result = await jwtCallback!({ token });
    expect(result.accessToken).toBe('ghu_still_valid');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refreshes the token by calling GitHub when expiry is within the buffer', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'ghu_refreshed',
          refresh_token: 'ghr_refreshed',
          expires_in: 28_800,
          token_type: 'bearer',
          scope: 'read:user',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    const token: JWT = {
      accessToken: 'ghu_expired',
      refreshToken: 'ghr_use_me',
      expiresAt: nowSec - 10, // already expired
    };

    const result = await jwtCallback!({ token });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchSpy.mock.calls[0];
    expect(endpoint).toBe('https://github.com/login/oauth/access_token');
    expect(init.method).toBe('POST');
    expect(init.body).toContain('grant_type=refresh_token');
    expect(init.body).toContain('refresh_token=ghr_use_me');
    expect(init.body).toContain('client_id=client_id_xyz');

    expect(result.accessToken).toBe('ghu_refreshed');
    expect(result.refreshToken).toBe('ghr_refreshed');
    expect((result.expiresAt as number) - nowSec).toBeGreaterThanOrEqual(28_700);
    expect(result.error).toBeUndefined();
  });

  it('keeps the existing refresh token when GitHub omits a new one', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: 'ghu_new', expires_in: 100 }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const token: JWT = {
      accessToken: 'ghu_old',
      refreshToken: 'ghr_keep',
      expiresAt: nowSec - 1,
    };
    const result = await jwtCallback!({ token });
    expect(result.refreshToken).toBe('ghr_keep');
  });

  it('marks the token with RefreshAccessTokenError when GitHub returns an error', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'bad_refresh_token',
          error_description: 'token revoked',
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const result = await jwtCallback!({
      token: {
        accessToken: 'ghu_old',
        refreshToken: 'ghr_bad',
        expiresAt: nowSec - 5,
      },
    });
    expect(result.error).toBe('RefreshAccessTokenError');
  });

  it('marks the token with RefreshAccessTokenError on HTTP failure', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('boom', { status: 500 })) as unknown as typeof fetch;

    const result = await jwtCallback!({
      token: {
        accessToken: 'ghu_old',
        refreshToken: 'ghr_bad',
        expiresAt: nowSec - 5,
      },
    });
    expect(result.error).toBe('RefreshAccessTokenError');
  });

  it('returns RefreshTokenMissing when expired but no refresh token is stored', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const result = await jwtCallback!({
      token: { accessToken: 'ghu_old', expiresAt: nowSec - 5 },
    });
    expect(result.error).toBe('RefreshTokenMissing');
  });
});

describe('Auth.js session callback (browser-reachable shape)', () => {
  it('exposes a session callback', () => {
    expect(typeof sessionCallback).toBe('function');
  });

  it('projects user.id, login, and error onto session', async () => {
    const session = { user: {} };
    const token: JWT = {
      userId: '12345',
      login: 'octocat',
      error: 'RefreshAccessTokenError',
    };
    const result = await sessionCallback!({ session, token });
    expect((result.user as { id?: string }).id).toBe('12345');
    expect((result as { login?: string }).login).toBe('octocat');
    expect((result as { error?: string }).error).toBe('RefreshAccessTokenError');
  });

  it('NEVER projects accessToken or refreshToken onto session (browser-reachable)', async () => {
    // Anything on the returned session object is sent verbatim by the
    // built-in /api/auth/session JSON endpoint and is reachable from
    // browser JS. The GitHub user-to-server access token and refresh token
    // must stay in the encrypted httpOnly JWT cookie. A regression here
    // would turn an XSS into full GitHub token theft.
    const session = { user: {} };
    const token: JWT = {
      userId: '12345',
      login: 'octocat',
      accessToken: 'ghu_supersecret',
      refreshToken: 'ghr_supersecret',
      expiresAt: 9999999999,
    };
    const result = await sessionCallback!({ session, token });

    expect(JSON.stringify(result)).not.toContain('ghu_supersecret');
    expect(JSON.stringify(result)).not.toContain('ghr_supersecret');
    expect(JSON.stringify(result)).not.toContain('accessToken');
    expect(JSON.stringify(result)).not.toContain('refreshToken');
    expect(JSON.stringify(result)).not.toContain('expiresAt');
  });
});

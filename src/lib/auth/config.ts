/**
 * Auth.js v5 configuration for Flight School.
 *
 * Uses the GitHub provider configured as a GitHub App so that user-to-server
 * (`ghu_`) tokens are issued with refresh tokens (8h access / 6mo refresh).
 *
 * Session strategy is JWT with an encrypted cookie. The access token,
 * refresh token, and expiry are stored on the token so server-side helpers
 * can hand them to Octokit / the Copilot SDK on a per-request basis.
 */

import NextAuth, { type NextAuthConfig } from 'next-auth';
import GitHub from 'next-auth/providers/github';

import { logger } from '@/lib/logger';

const log = logger.withTag('Auth');

/**
 * GitHub App OAuth scopes. `repo` is required for the repo-creation features
 * in `src/lib/github/repos.ts`; the rest cover profile, email, and org reads.
 */
const GITHUB_SCOPES = 'read:user user:email read:org repo';

/** Buffer before the actual expiry when we proactively refresh (seconds). */
const REFRESH_BUFFER_SECONDS = 60;

interface RefreshedToken {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in?: number;
  token_type: string;
  scope: string;
  error?: string;
  error_description?: string;
}

/**
 * Exchange a refresh token for a fresh `ghu_` access token.
 * GitHub Apps with user-to-server refresh enabled return both a new access
 * token and a rotated refresh token.
 */
async function refreshGitHubAccessToken(refreshToken: string): Promise<RefreshedToken> {
  const clientId = process.env.AUTH_GITHUB_ID;
  const clientSecret = process.env.AUTH_GITHUB_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('AUTH_GITHUB_ID / AUTH_GITHUB_SECRET must be set to refresh GitHub tokens.');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`GitHub token refresh failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as RefreshedToken;
  if (data.error) {
    throw new Error(`GitHub token refresh failed: ${data.error} ${data.error_description ?? ''}`);
  }
  return data;
}

export const authConfig: NextAuthConfig = {
  session: { strategy: 'jwt' },
  trustHost: true,
  pages: {
    signIn: '/sign-in',
  },
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      authorization: {
        params: {
          scope: GITHUB_SCOPES,
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      // First-time sign-in: persist tokens from the GitHub OAuth response.
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt =
          typeof account.expires_at === 'number'
            ? account.expires_at
            : Math.floor(Date.now() / 1000) + (typeof account.expires_in === 'number' ? account.expires_in : 0);
        if (profile && typeof profile === 'object') {
          const ghProfile = profile as { id?: number | string; login?: string };
          if (ghProfile.id !== undefined) token.userId = String(ghProfile.id);
          if (ghProfile.login) token.login = ghProfile.login;
        }
        return token;
      }

      // Subsequent requests: refresh if we are within the buffer window.
      const expiresAt = typeof token.expiresAt === 'number' ? token.expiresAt : 0;
      const refreshToken = typeof token.refreshToken === 'string' ? token.refreshToken : undefined;
      const nowSec = Math.floor(Date.now() / 1000);

      if (!expiresAt || expiresAt - REFRESH_BUFFER_SECONDS > nowSec) {
        return token;
      }
      if (!refreshToken) {
        log.warn('JWT expired but no refresh token is available; user must re-authenticate');
        return { ...token, error: 'RefreshTokenMissing' as const };
      }

      try {
        const refreshed = await refreshGitHubAccessToken(refreshToken);
        token.accessToken = refreshed.access_token;
        token.refreshToken = refreshed.refresh_token ?? refreshToken;
        token.expiresAt = Math.floor(Date.now() / 1000) + refreshed.expires_in;
        delete (token as { error?: string }).error;
        log.debug('Refreshed GitHub user-to-server access token');
        return token;
      } catch (error) {
        log.error('Failed to refresh GitHub access token', error);
        return { ...token, error: 'RefreshAccessTokenError' as const };
      }
    },

    async session({ session, token }) {
      if (typeof token.userId === 'string') {
        session.user = { ...(session.user ?? {}), id: token.userId } as typeof session.user;
      }
      if (typeof token.login === 'string') {
        (session as { login?: string }).login = token.login;
      }
      if (typeof token.accessToken === 'string') {
        (session as { accessToken?: string }).accessToken = token.accessToken;
      }
      if (typeof token.error === 'string') {
        (session as { error?: string }).error = token.error;
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

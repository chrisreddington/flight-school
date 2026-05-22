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

import { refreshGitHubAccessToken } from './github-oauth';
import { getTokenStore, type StoredToken } from './token-store';

const log = logger.withTag('Auth');

/**
 * Persist the user's GitHub tokens to the configured {@link TokenStore} on a
 * best-effort basis. The JWT cookie remains the source of truth for the
 * request; the store is what we rely on for server-side refresh and audit.
 * Failures are logged and swallowed so an outage in Cosmos/Key Vault never
 * locks users out of the application.
 *
 * Uses {@link TokenStore.setTokenIfNewer} so a slow JWT callback (e.g. on
 * one ACA replica) cannot clobber a newer record persisted by another
 * replica that already refreshed.
 */
async function persistTokenToStore(userId: string, stored: StoredToken): Promise<void> {
  try {
    await getTokenStore().setTokenIfNewer(userId, stored);
  } catch (error) {
    log.warn('Failed to persist token to token store (continuing with cookie-only)', error);
  }
}

/**
 * GitHub App OAuth scopes. `repo` is required for the repo-creation features
 * in `src/lib/github/repos.ts`; the rest cover profile, email, and org reads.
 */
const GITHUB_SCOPES = 'read:user user:email read:org repo';

/** Buffer before the actual expiry when we proactively refresh (seconds). */
const REFRESH_BUFFER_SECONDS = 60;

/**
 * Auth.js v5 configuration object. Wires the GitHub provider, JWT session
 * strategy, sign-in page, and the {@link authConfig.callbacks.jwt} /
 * {@link authConfig.callbacks.session} callbacks.
 *
 * @remarks
 * Session strategy is JWT (signed, encrypted cookie). The JWT callback owns
 * token refresh; the session callback projects the relevant fields onto
 * `session` for client and server consumers. Mutating this object after
 * `NextAuth()` is constructed has no effect — re-export {@link handlers} /
 * {@link auth} / {@link signIn} / {@link signOut} from this module.
 */
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
    /**
     * JWT callback. Runs on sign-in and on every authenticated request that
     * touches the session cookie.
     *
     * @remarks
     * - **First sign-in** (`account` is defined): captures the GitHub
     *   `accessToken` / `refreshToken` / `expiresAt` plus the `userId` and
     *   `login` from the OAuth profile, and best-effort-persists the token
     *   triple to the {@link TokenStore}.
     * - **Subsequent requests**: if `expiresAt - REFRESH_BUFFER_SECONDS`
     *   has passed, exchanges the refresh token for a fresh `ghu_` access
     *   token via GitHub's `/login/oauth/access_token` endpoint and
     *   re-persists. On refresh failure the token is returned with
     *   `error: 'RefreshAccessTokenError'`; on missing refresh token,
     *   `'RefreshTokenMissing'`. Callers detect these via
     *   {@link UserContext} returning `null` from `getUserContext()`, which
     *   forces a re-auth.
     */
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
        if (typeof token.userId === 'string' && typeof token.accessToken === 'string') {
          await persistTokenToStore(token.userId, {
            accessToken: token.accessToken,
            refreshToken: typeof token.refreshToken === 'string' ? token.refreshToken : undefined,
            expiresAt: token.expiresAt,
          });
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
        if (typeof token.userId === 'string') {
          await persistTokenToStore(token.userId, {
            accessToken: refreshed.access_token,
            refreshToken: token.refreshToken,
            expiresAt: token.expiresAt,
          });
        }
        return token;
      } catch (error) {
        log.error('Failed to refresh GitHub access token', error);
        return { ...token, error: 'RefreshAccessTokenError' as const };
      }
    },

    /**
     * Session callback. Projects fields off the JWT onto the session object
     * exposed to server components and API routes.
     *
     * @remarks
     * **Security invariant:** the session object is returned by the
     * NextAuth-builtin `/api/auth/session` endpoint and reachable from
     * browser JavaScript. We deliberately project only non-sensitive
     * identity (`user.id`, `login`) and the refresh-failure marker
     * (`error`). The GitHub access token, refresh token, and expiry stay
     * in the encrypted httpOnly JWT cookie; server-side helpers in
     * {@link getUserContext} read them via `next-auth/jwt`'s `getToken()`.
     */
    async session({ session, token }) {
      if (typeof token.userId === 'string') {
        session.user = { ...(session.user ?? {}), id: token.userId } as typeof session.user;
      }
      if (typeof token.login === 'string') {
        (session as { login?: string }).login = token.login;
      }
      if (typeof token.error === 'string') {
        (session as { error?: string }).error = token.error;
      }
      return session;
    },
  },
  events: {
    /**
     * Clear the deletion tombstone after a fresh sign-in so the user
     * can use the app again. The marker is written by
     * `DELETE /api/user/data` to block in-flight executors from
     * recreating per-user data immediately after the wipe; once the
     * user explicitly signs back in we know the wipe has settled and
     * future writes are intentional.
     */
    async signIn({ user }) {
      const userId = user?.id;
      if (typeof userId !== 'string' || userId.length === 0) return;
      try {
        const { clearUserTombstone } = await import('@/lib/storage/tombstone');
        await clearUserTombstone(userId);
      } catch {
        // best-effort — tombstone remains and the user can retry sign-in.
      }
    },
  },
};

/**
 * Auth.js v5 entry points built from {@link authConfig}.
 *
 * - `handlers` — `GET`/`POST` route handlers to re-export from
 *   `src/app/api/auth/[...nextauth]/route.ts`.
 * - `auth` — server-side accessor for the current session; used by
 *   {@link getUserContext} and middleware.
 * - `signIn` / `signOut` — server-action helpers for the sign-in page and
 *   sign-out controls.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

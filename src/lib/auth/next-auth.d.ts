/**
 * Module augmentation for Auth.js v5 types.
 *
 * Extends the JWT and Session shapes with the GitHub-specific fields we
 * persist (access token, refresh token, expiry, user id, login).
 */

import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    /**
     * GitHub login (username). Safe to expose to the client.
     */
    login?: string;
    /**
     * Refresh-failure marker set by the JWT callback when the refresh
     * exchange with GitHub fails. Client and server code use this to drive
     * a re-auth prompt. Never carries the underlying error detail.
     */
    error?: 'RefreshAccessTokenError' | 'RefreshTokenMissing';
    user?: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
    // accessToken is deliberately NOT on Session. Anything projected onto
    // `session` is returned by the NextAuth-builtin /api/auth/session
    // endpoint and reachable from browser JS — exposing the GitHub user-to-
    // server token there turns an XSS into a full token theft. Server-side
    // helpers (see src/lib/auth/context.ts) read the access token from the
    // raw encrypted JWT cookie via next-auth/jwt's getToken().
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    userId?: string;
    login?: string;
    /**
     * Unix seconds when the user last actually signed in via OAuth (not
     * the rolling JWT `iat`). Set only in the `account` branch of the
     * JWT callback. Used to enforce "recent auth" on destructive routes.
     */
    lastSignInAt?: number;
    error?: 'RefreshAccessTokenError' | 'RefreshTokenMissing';
  }
}

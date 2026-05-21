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
    accessToken?: string;
    login?: string;
    error?: 'RefreshAccessTokenError' | 'RefreshTokenMissing';
    user?: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    userId?: string;
    login?: string;
    error?: 'RefreshAccessTokenError' | 'RefreshTokenMissing';
  }
}

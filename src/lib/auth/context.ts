/**
 * Server-only helpers for resolving the current authenticated user.
 *
 * Downstream services (Octokit, Copilot SDK) call `getUserContext()` /
 * `requireUserContext()` to retrieve the per-request GitHub `ghu_` token.
 *
 * The access token is read from the **raw encrypted JWT cookie** via
 * `next-auth/jwt`'s `getToken()`, not from the public session object.
 * Anything on `session` is returned by NextAuth's built-in
 * `/api/auth/session` endpoint and reachable from browser JS; the access
 * token must never travel that path.
 */

import 'server-only';

import { headers } from 'next/headers';
import { getToken } from 'next-auth/jwt';

import { auth } from '@/lib/auth/config';

export interface UserContext {
  /** Stable GitHub numeric ID as a string. */
  userId: string;
  /** GitHub login (username). */
  login: string;
  /** Fresh user-to-server access token (`ghu_...`). */
  accessToken: string;
}

/**
 * Error thrown when an API route requires authentication but none is present.
 * The status field is intentionally HTTP-shaped so callers can map it directly
 * to a response.
 */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Read the access token from the raw encrypted JWT cookie. Server-only.
 * Never leaks into client-reachable session JSON.
 *
 * @internal
 */
async function readAccessTokenFromJwt(): Promise<string | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const req: { headers: Headers } = { headers: await headers() };
  const jwt = await getToken({
    req,
    secret,
    // Auto-detect cookie name (Secure prefix in prod / unprefixed in dev)
    // based on the request URL. NextAuth defaults are correct here.
  });
  if (!jwt || typeof jwt.accessToken !== 'string') return null;
  return jwt.accessToken;
}

/**
 * Read the Auth.js session and return the GitHub user context, or null if
 * the request is unauthenticated or the token has expired without refresh.
 *
 * @remarks
 * The session object provides the user identity and refresh-failure marker;
 * the access token is read separately from the raw JWT cookie via
 * {@link readAccessTokenFromJwt} so it never traverses the client-reachable
 * `/api/auth/session` JSON.
 */
export async function getUserContext(): Promise<UserContext | null> {
  const session = await auth();
  if (!session) return null;
  if (session.error) return null;

  const login = session.login;
  const userId = session.user?.id;
  if (!login || !userId) return null;

  const accessToken = await readAccessTokenFromJwt();
  if (!accessToken) return null;

  return { userId, login, accessToken };
}

/**
 * Like {@link getUserContext} but throws {@link UnauthorizedError} when the
 * request is unauthenticated. Use this inside API route handlers.
 */
export async function requireUserContext(): Promise<UserContext> {
  const ctx = await getUserContext();
  if (!ctx) throw new UnauthorizedError();
  return ctx;
}

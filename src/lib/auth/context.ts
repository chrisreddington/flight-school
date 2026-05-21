/**
 * Server-only helpers for resolving the current authenticated user.
 *
 * Downstream services (Octokit refactor in P2, Copilot SDK refactor in P3)
 * call `getUserContext()` to retrieve the per-request GitHub `ghu_` token
 * instead of reaching for the process-wide `GITHUB_TOKEN`.
 */

import 'server-only';

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
 * Read the Auth.js session and return the GitHub user context, or null if
 * the request is unauthenticated or the token has expired without refresh.
 */
export async function getUserContext(): Promise<UserContext | null> {
  const session = await auth();
  if (!session) return null;
  if (session.error) return null;

  const accessToken = session.accessToken;
  const login = session.login;
  const userId = session.user?.id;
  if (!accessToken || !login || !userId) return null;

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

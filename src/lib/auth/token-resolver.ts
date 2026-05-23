/**
 * Token resolution for background-job execution.
 *
 * Long-running jobs cannot rely on the access token captured at HTTP request
 * time: GitHub user-to-server access tokens are valid for ~8 hours, but
 * queued / retried work may execute much later. This module resolves a
 * **fresh** access token from the {@link TokenStore} at the moment the job
 * actually runs, refreshing via the OAuth refresh-token flow when the
 * cached token is at (or within {@link REFRESH_LEEWAY_MS} of) expiry.
 *
 * Callers (job executors) must:
 * 1. Persist `userId` on the job payload — never the access token.
 * 2. Call {@link resolveFreshGitHubToken} at the start of execution.
 * 3. On `null`, fail the job with a "credentials missing" audit event;
 *    on `throw`, fail the job with a "refresh failed, re-auth required"
 *    audit event. Do NOT retry blindly — the user must re-authenticate.
 */

import 'server-only';

import { logger } from '@/lib/logger';
import { nowMs } from '@/lib/utils/date-utils';

import { refreshGitHubAccessToken } from './github-oauth';
import { getTokenStore } from './token-store';

const log = logger.withTag('TokenResolver');

/**
 * Leeway window before expiry within which we proactively refresh rather
 * than handing out a token that will die mid-job. Five minutes is generous
 * enough to cover slow Copilot SDK turns and Octokit pagination, while
 * still narrow enough that we don't refresh on every read.
 */
export const REFRESH_LEEWAY_MS = 5 * 60 * 1000;

/**
 * Resolve a fresh GitHub user-to-server access token for the given userId.
 *
 * @param userId - Stable GitHub numeric ID (as string) of the user the job
 *   is acting on behalf of. Must match the `userId` partition used at
 *   token persistence time (see `src/lib/auth/config.ts`).
 * @returns A `ghu_...` access token guaranteed to be more than
 *   {@link REFRESH_LEEWAY_MS} away from expiry, or `null` when no token
 *   record exists for `userId` (user has never authenticated, has signed
 *   out, or the record was swept by `cleanupExpired`). Callers should
 *   treat `null` as 401-equivalent: fail the job and surface a "re-auth
 *   required" status.
 * @throws When the cached token is within the refresh window but the
 *   refresh exchange with GitHub fails (HTTP error, revoked refresh
 *   token, missing `AUTH_GITHUB_*` env). Callers must mark the job as
 *   "credentials expired, user must re-auth" and **not** retry — the
 *   refresh token is no longer usable.
 */
export async function resolveFreshGitHubToken(userId: string): Promise<string | null> {
  const store = getTokenStore();
  const stored = await store.getToken(userId);
  if (!stored) {
    log.debug('No stored token for user; resolveFreshGitHubToken returning null', { userId });
    return null;
  }

  const expiresAtMs = stored.expiresAt * 1000;
  // Fail-closed: expiresAt of 0 (unset/unknown) is treated as expired so we
  // refresh rather than handing out a token of indeterminate age.
  const needsRefresh = expiresAtMs - REFRESH_LEEWAY_MS <= nowMs();
  if (!needsRefresh) {
    return stored.accessToken;
  }

  if (!stored.refreshToken) {
    log.warn('Stored token is within refresh window but no refresh token is available', { userId });
    throw new Error('GitHub token refresh required but no refresh token is stored for this user.');
  }

  const refreshed = await refreshGitHubAccessToken(stored.refreshToken);
  const newExpiresAt = Math.floor(nowMs() / 1000) + refreshed.expires_in;
  // CAS write: if another replica already refreshed concurrently and
  // persisted a newer record, do not clobber it.
  await store.setTokenIfNewer(userId, {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? stored.refreshToken,
    expiresAt: newExpiresAt,
  });
  log.debug('Refreshed GitHub access token for background job execution', { userId });
  return refreshed.access_token;
}

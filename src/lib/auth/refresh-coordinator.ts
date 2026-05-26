/**
 * Per-userId coordinator for the GitHub refresh-token exchange.
 *
 * GitHub rotates the refresh token on its first use: the old token becomes
 * invalid the moment a refresh succeeds. Without coordination, N concurrent
 * authenticated requests for the same user (RSC render + OTel beacons + page
 * subresources, all carrying the same JWT cookie) each call
 * `refreshGitHubAccessToken` with the same refresh token. The first wins;
 * the rest fail with `bad_refresh_token` and force a re-auth.
 *
 * This module wraps the refresh exchange with two layers of protection:
 *
 * 1. **In-flight coalescing** — a process-local map keyed by `userId` holds
 *    the in-flight refresh Promise. Concurrent callers await the same
 *    Promise; GitHub is hit exactly once per burst.
 * 2. **Store-first fallback** — before each refresh we read the
 *    {@link TokenStore}. If it already holds a credential whose
 *    `refreshToken` differs from ours, an earlier round has rotated us;
 *    return the stored credential instead of re-redeeming.
 *
 * @remarks
 * **Scope:** process-local. In multi-replica deployments (ACA, etc.) the
 * cross-replica race still exists, but layer 2 mitigates most of it because
 * the persistent store is shared. A truly cross-replica lock would require
 * a `setIfAbsent` semaphore on the store and is out of scope here.
 */

import 'server-only';

import { logger } from '@/lib/logger';
import { nowMs } from '@/lib/utils/date-utils';

import { refreshGitHubAccessToken } from './github-oauth';
import { getTokenStore, type StoredToken } from './token-store';

const log = logger.withTag('RefreshCoordinator');

const pending = new Map<string, Promise<StoredToken>>();

/**
 * Refresh the GitHub user-to-server access token for `userId`, coalescing
 * concurrent calls and preferring an already-rotated credential from the
 * store over a re-redemption that would fail.
 *
 * @param userId - Stable GitHub numeric ID (as string).
 * @param refreshToken - The caller's current refresh token (`ghr_...`).
 *   May be stale if another round has already rotated it; layer 2 detects
 *   that case.
 * @returns The freshest `StoredToken` for the user — either the result of
 *   a fresh GitHub exchange or the store's existing newer record.
 * @throws When the refresh exchange with GitHub itself fails (HTTP error
 *   or `error` field in the response body). Callers should mark the
 *   session in error and surface a re-auth.
 */
export async function refreshGitHubTokenForUser(userId: string, refreshToken: string): Promise<StoredToken> {
  const inflight = pending.get(userId);
  if (inflight) {
    return inflight;
  }

  const work = doRefresh(userId, refreshToken).finally(() => {
    pending.delete(userId);
  });
  pending.set(userId, work);
  return work;
}

async function doRefresh(userId: string, refreshToken: string): Promise<StoredToken> {
  const store = getTokenStore();

  const stored = await store.getToken(userId);
  if (stored && stored.refreshToken && stored.refreshToken !== refreshToken) {
    // Layer 2: another round already rotated us. The store has the newer
    // credential; using it avoids a guaranteed `bad_refresh_token` here.
    log.debug('Using store record; caller refresh token has been rotated', { userId });
    return stored;
  }

  const refreshed = await refreshGitHubAccessToken(refreshToken);
  const next: StoredToken = {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? refreshToken,
    expiresAt: Math.floor(nowMs() / 1000) + refreshed.expires_in,
  };
  await store.setTokenIfNewer(userId, next);
  log.debug('Refreshed GitHub user-to-server access token', { userId });
  return next;
}

/**
 * Test-only: clears the in-flight map so individual test cases don't leak
 * state. Not exported through any production code path.
 *
 * @internal
 */
export function __resetRefreshCoordinatorForTests(): void {
  pending.clear();
}

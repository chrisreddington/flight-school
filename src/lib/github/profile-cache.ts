/**
 * Profile Cache Helpers
 *
 * In-memory cache for profile data to reduce GitHub API calls.
 */

import type { GitHubRepo, GitHubUser } from './types';
import { nowMs } from '@/lib/utils/date-utils';

/** Cache TTL: 5 minutes */
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedProfile {
  user: GitHubUser;
  repos: GitHubRepo[];
  fetchedAt: number;
}

const profileCache = new Map<string, CachedProfile>();

/**
 * Retrieves cached profile data if it's still valid.
 *
 * @param login - GitHub login of the user
 * @returns Cached profile or null if missing/expired
 */
export function getCachedProfile(login: string): CachedProfile | null {
  const cached = profileCache.get(login);
  if (cached && nowMs() - cached.fetchedAt < PROFILE_CACHE_TTL_MS) {
    return cached;
  }
  return null;
}

/**
 * Caches the latest profile data.
 *
 * @param login - GitHub login of the user
 * @param user - Authenticated user
 * @param repos - User repositories
 */
export function setCachedProfile(login: string, user: GitHubUser, repos: GitHubRepo[]): void {
  profileCache.set(login, { user, repos, fetchedAt: nowMs() });
}

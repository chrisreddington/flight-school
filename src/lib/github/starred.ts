/**
 * Starred Repositories Interest Signals
 *
 * Fetches recently starred repos to build a lightweight interest profile.
 * Per Self-Determination Theory research: content aligned with the learner's
 * autonomously-chosen interests sustains intrinsic motivation.
 */

import { getOctokit } from './client';
import { nowMs } from '@/lib/utils/date-utils';

// =============================================================================
// Constants
// =============================================================================

/** Cache TTL: 24 hours */
const STARRED_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Number of recently starred repos to fetch */
const STARRED_LIMIT = 20;

// =============================================================================
// Cache
// =============================================================================

interface CachedStarred {
  interests: string[];
  timestamp: number;
}

let starredCache: CachedStarred | null = null;

// =============================================================================
// Public API
// =============================================================================

/**
 * Extracts interest signals from the user's most recently starred repositories.
 *
 * @remarks
 * Returns a deduplicated list of languages and topics from the last STARRED_LIMIT
 * starred repos. Cached for 24 hours. Used in `buildCompactContext` as the
 * `si` (star interests) field.
 *
 * @param username - GitHub username
 * @returns Deduplicated array of interest signals (languages + topics)
 */
export async function getStarredInterests(username: string): Promise<string[]> {
  if (starredCache && nowMs() - starredCache.timestamp < STARRED_CACHE_TTL_MS) {
    return starredCache.interests;
  }

  const interests = await fetchStarredInterests(username);
  starredCache = { interests, timestamp: nowMs() };
  return interests;
}

// =============================================================================
// Internal helpers
// =============================================================================

async function fetchStarredInterests(username: string): Promise<string[]> {
  try {
    const octokit = await getOctokit();
    const response = await octokit.rest.activity.listReposStarredByUser({
      username,
      per_page: STARRED_LIMIT,
      sort: 'created',
      direction: 'desc',
    });

    const signals = new Set<string>();

    for (const repo of response.data) {
      // Octokit returns either full repo objects or starred objects
      const repoData = 'repo' in repo ? repo.repo : repo;

      if (repoData.language) {
        signals.add(repoData.language.toLowerCase());
      }

      if ('topics' in repoData && Array.isArray(repoData.topics)) {
        for (const topic of repoData.topics) {
          signals.add(topic.toLowerCase());
        }
      }
    }

    return Array.from(signals).slice(0, 15);
  } catch {
    return [];
  }
}

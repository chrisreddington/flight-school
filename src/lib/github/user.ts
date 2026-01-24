/**
 * GitHub User API
 *
 * Functions for fetching authenticated user data via Octokit.
 * Provides simple, direct access without LLM overhead.
 * Includes caching for performance optimization.
 */

import { getOctokit } from './client';
import { nowMs } from '@/lib/utils/date-utils';
import type { GitHubUser } from './types';

// =============================================================================
// Profile Caching
// =============================================================================

/** Cache TTL: 5 minutes */
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedProfile {
  user: GitHubUser;
  timestamp: number;
}

let profileCache: CachedProfile | null = null;

/**
 * Get the authenticated user's profile with caching.
 *
 * Caches the profile for 5 minutes to reduce API calls and latency.
 *
 * @returns GitHub user profile data
 */
export async function getAuthenticatedUser(): Promise<GitHubUser> {
  const nowTimestamp = nowMs();
  
  if (profileCache && (nowTimestamp - profileCache.timestamp) < PROFILE_CACHE_TTL_MS) {
    return profileCache.user;
  }
  
  // Fetch from API
  const octokit = await getOctokit();
  const { data } = await octokit.rest.users.getAuthenticated();

  const user: GitHubUser = {
    login: data.login,
    name: data.name,
    avatarUrl: data.avatar_url,
    bio: data.bio,
    company: data.company,
    location: data.location,
    publicRepos: data.public_repos,
    followers: data.followers,
    following: data.following,
    createdAt: data.created_at,
  };
  
  profileCache = { user, timestamp: nowTimestamp };
  return user;
}

/**
 * Calculate experience level based on GitHub metrics.
 *
 * @param yearsOnGitHub - Years since account creation
 * @param publicRepos - Number of public repositories
 * @param followers - Number of followers
 * @returns Experience level classification (3-level taxonomy)
 */
export function calculateExperienceLevel(
  yearsOnGitHub: number,
  publicRepos: number,
  followers: number
): 'beginner' | 'intermediate' | 'advanced' {
  const score = yearsOnGitHub * 2 + publicRepos * 0.5 + followers * 0.1;
  if (score >= 30) return 'advanced';
  if (score >= 10) return 'intermediate';
  return 'beginner';
}

/**
 * Calculates years on GitHub from account creation date.
 *
 * @param createdAt - ISO timestamp of account creation
 * @returns Years since account creation (floored)
 */
export function calculateYearsOnGitHub(createdAt: string): number {
  return Math.floor(
    (nowMs() - new Date(createdAt).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  );
}

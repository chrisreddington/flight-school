/**
 * GitHub User API
 *
 * Functions for fetching authenticated user data via Octokit.
 * Provides simple, direct access without LLM overhead.
 */

import type { Octokit } from 'octokit';
import { nowMs } from '@/lib/utils/date-utils';
import type { GitHubUser } from './types';

/**
 * Get the authenticated user's profile.
 *
 * @param octokit - Per-request Octokit bound to the caller's session token
 * @returns GitHub user profile data
 */
export async function getAuthenticatedUser(octokit: Octokit): Promise<GitHubUser> {
  const { data } = await octokit.rest.users.getAuthenticated();

  return {
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

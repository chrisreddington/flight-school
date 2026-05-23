/**
 * Profile API Route
 * GET /api/profile
 *
 * Uses Octokit (per-request, bound to the caller's session token) for direct
 * GitHub API access. Auth is enforced by middleware before this handler runs.
 */

import { getOctokitForRequest } from '@/lib/github/client';
import { knownApiErrorResponse } from '@/lib/api/auth-errors';
import { nowMs } from '@/lib/utils/date-utils';
import {
    calculateActivityMetrics,
    calculateExperienceLevel,
    calculateYearsOnGitHub,
    getAuthenticatedUser,
    getLanguageStats,
    getUserEvents,
    getUserRepositories,
} from '@/lib/github';
import { getCachedProfile, setCachedProfile } from '@/lib/github/profile-cache';
import { logger } from '@/lib/logger';
import type { ExperienceLevel } from '@/lib/skills/types';
import { NextResponse } from 'next/server';

const log = logger.withTag('Profile API');

// Cache helpers moved to src/lib/github/profile-cache.ts

export interface ProfileResponse {
  user: {
    login: string;
    name: string | null;
    avatarUrl: string;
    bio: string | null;
    company: string | null;
    location: string | null;
    totalRepos: number;
    followers: number;
    following: number;
    memberSince: string;
  };
  stats: {
    experienceLevel: ExperienceLevel;
    yearsOnGitHub: number;
    topLanguages: Array<{ name: string; percentage: number; color: string }>;
  };
  pastSevenDays: {
    commits: number;
    pullRequests: number;
    reposUpdated: number;
  };
  /** User's repositories for context selection */
  repos: Array<{
    fullName: string;
    owner: string;
    name: string;
    language: string | null;
  }>;
  meta: {
    cached: boolean;
    aiEnabled: boolean;
    method: string;
    totalTimeMs: number;
    /** Authentication method: 'github-oauth' for signed-in users, 'none' for fallback responses. */
    authMethod: 'github-oauth' | 'none';
  };
}

function getFallbackResponse(startTime: number): ProfileResponse {
  return {
    user: {
      login: 'demo-user',
      name: 'Demo User',
      avatarUrl: 'https://avatars.githubusercontent.com/u/0?v=4',
      bio: 'Could not fetch profile. Please check your configuration.',
      company: null,
      location: null,
      totalRepos: 0,
      followers: 0,
      following: 0,
      memberSince: new Date().getFullYear().toString(),
    },
    stats: {
      experienceLevel: 'beginner',
      yearsOnGitHub: 0,
      topLanguages: [],
    },
    pastSevenDays: { commits: 0, pullRequests: 0, reposUpdated: 0 },
    repos: [],
    meta: {
      cached: false,
      aiEnabled: false,
      method: 'fallback',
      totalTimeMs: nowMs() - startTime,
      authMethod: 'none',
    },
  };
}

/** Use getLanguageColor from @/lib/github for language colors */

export async function GET() {
  const startTime = nowMs();
  log.info('Request started');

  let octokit: Awaited<ReturnType<typeof getOctokitForRequest>>;
  try {
    octokit = await getOctokitForRequest();
  } catch (error) {
    const knownResponse = knownApiErrorResponse(error);
    if (knownResponse) return knownResponse;
    throw error;
  }

  // Fetch user first so we can scope the cache by login
  let user;
  try {
    user = await getAuthenticatedUser(octokit);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to fetch authenticated user:', errorMessage);
    return NextResponse.json(getFallbackResponse(startTime));
  }

  // Check cache first (keyed by login to avoid cross-user leaks)
  const cached = getCachedProfile(user.login);
  if (cached) {
    log.info('Returning cached profile');
    const yearsOnGitHub = calculateYearsOnGitHub(cached.user.createdAt);

    // Map cached repos to RepoReference format
    const repoList = cached.repos.map((repo) => {
      const [owner, name] = repo.fullName.split('/');
      return {
        fullName: repo.fullName,
        owner,
        name,
        language: repo.language,
      };
    });

    // Fetch activity metrics even for cached profile (activity changes frequently)
    let pastSevenDays = { commits: 0, pullRequests: 0, reposUpdated: 0 };
    try {
      const events = await getUserEvents(octokit, cached.user.login, 100);
      const metrics = calculateActivityMetrics(events, 7);
      pastSevenDays = {
        commits: metrics.commits,
        pullRequests: metrics.pullRequests,
        reposUpdated: metrics.reposUpdated,
      };
    } catch (activityError) {
      log.warn('Could not fetch activity for cached profile:', activityError);
    }

    return NextResponse.json({
      user: {
        login: cached.user.login,
        name: cached.user.name,
        avatarUrl: cached.user.avatarUrl,
        bio: cached.user.bio,
        company: cached.user.company,
        location: cached.user.location,
        totalRepos: cached.repos.length,
        followers: cached.user.followers,
        following: cached.user.following,
        memberSince: new Date(cached.user.createdAt).getFullYear().toString(),
      },
      stats: {
        experienceLevel: calculateExperienceLevel(
          yearsOnGitHub,
          cached.repos.length,
          cached.user.followers
        ),
        yearsOnGitHub,
        topLanguages: getLanguageStats(cached.repos),
      },
      pastSevenDays,
      repos: repoList,
      meta: {
        cached: true,
        aiEnabled: true,
        method: 'octokit-cached',
        totalTimeMs: nowMs() - startTime,
        authMethod: 'github-oauth',
      },
    } satisfies ProfileResponse);
  }

  try {
    // Fetch repos (user already fetched above)
    log.info('Fetching repos...');
    const repos = await getUserRepositories(octokit, { perPage: 100 });

    // Cache the profile (keyed by login)
    setCachedProfile(user.login, user, repos);
    log.info('Profile cached');

    const yearsOnGitHub = calculateYearsOnGitHub(user.createdAt);

    // Try to fetch activity metrics (non-blocking on failure)
    let pastSevenDays = { commits: 0, pullRequests: 0, reposUpdated: 0 };
    try {
      const events = await getUserEvents(octokit, user.login, 100);
      const metrics = calculateActivityMetrics(events, 7);
      pastSevenDays = {
        commits: metrics.commits,
        pullRequests: metrics.pullRequests,
        reposUpdated: metrics.reposUpdated,
      };
    } catch (activityError) {
      log.warn('Could not fetch activity:', activityError);
    }

    const totalTime = nowMs() - startTime;
    log.info(`Complete in ${totalTime}ms`);

    // Map repos to RepoReference format
    const repoList = repos.map((repo) => {
      const [owner, name] = repo.fullName.split('/');
      return {
        fullName: repo.fullName,
        owner,
        name,
        language: repo.language,
      };
    });

    const profileResponse: ProfileResponse = {
      user: {
        login: user.login,
        name: user.name,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        company: user.company,
        location: user.location,
        totalRepos: repos.length,
        followers: user.followers,
        following: user.following,
        memberSince: new Date(user.createdAt).getFullYear().toString(),
      },
      stats: {
        experienceLevel: calculateExperienceLevel(
          yearsOnGitHub,
          repos.length,
          user.followers
        ),
        yearsOnGitHub,
        topLanguages: getLanguageStats(repos),
      },
      pastSevenDays,
      repos: repoList,
      meta: {
        cached: false,
        aiEnabled: true,
        method: 'octokit-direct',
        totalTimeMs: totalTime,
        authMethod: 'github-oauth',
      },
    };

    return NextResponse.json(profileResponse);
  } catch (error) {
    const totalTime = nowMs() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error(`Error after ${totalTime}ms:`, errorMessage);

    return NextResponse.json(getFallbackResponse(startTime));
  }
}

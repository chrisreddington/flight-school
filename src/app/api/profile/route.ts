/**
 * Profile API Route
 * GET /api/profile
 *
 * Primary: Uses Octokit for direct GitHub API access — fast, deterministic data fetch.
 * Fallback: Uses Copilot SDK MCP tools when GITHUB_TOKEN is not configured.
 *
 * The Copilot SDK has its own authentication mechanism, so MCP tools can
 * fetch GitHub data even without a separate GITHUB_TOKEN.
 */

import { createLoggedChatSession } from '@/lib/copilot/server';
import { now, nowMs } from '@/lib/utils/date-utils';
import { extractJSON } from '@/lib/utils/json-utils';
import {
    calculateActivityMetrics,
    calculateExperienceLevel,
    calculateYearsOnGitHub,
    getAuthenticatedUser,
    getLanguageColor,
    getLanguageStats,
    getUserEvents,
    getUserRepositories,
    isGitHubConfigured,
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
    },
  };
}

/** Use getLanguageColor from @/lib/github for language colors */

/**
 * Fetch profile using Copilot SDK MCP tools.
 * Used when GITHUB_TOKEN is not configured.
 */
async function fetchProfileViaMcp(startTime: number): Promise<ProfileResponse> {
  log.info('Using Copilot SDK MCP tools for profile fetch');

  const loggedSession = await createLoggedChatSession(
    'Profile Fetch (MCP)',
    'Fetch user profile and repositories via MCP tools'
  );

  try {
    const prompt = `I need to fetch GitHub profile data. Please use the GitHub MCP tools to:
1. Call get_me to get my user profile
2. Call list_user_repositories to get my repositories (up to 100)

Return the data as JSON in this exact format:
{
  "user": {
    "login": "username",
    "name": "Full Name",
    "avatar_url": "https://...",
    "bio": "...",
    "company": "...",
    "location": "...",
    "public_repos": 0,
    "followers": 0,
    "following": 0,
    "created_at": "2020-01-01T00:00:00Z"
  },
  "repos": [
    { "name": "repo-name", "language": "TypeScript" }
  ]
}

Return ONLY the JSON, no explanation.`;

    const result = await loggedSession.sendAndWait(prompt);
    await loggedSession.destroy();

    const parsed = extractJSON<{
      user: {
        login: string;
        name?: string;
        avatar_url?: string;
        bio?: string;
        company?: string;
        location?: string;
        public_repos?: number;
        followers?: number;
        following?: number;
        created_at?: string;
      };
      repos: Array<{ name: string; language?: string }>;
    }>(result.responseText);

    if (!parsed?.user) {
      log.error('Failed to parse MCP response');
      return getFallbackResponse(startTime);
    }

    // Calculate language stats from repos
    const languageCounts: Record<string, number> = {};
    for (const repo of parsed.repos || []) {
      if (repo.language) {
        languageCounts[repo.language] = (languageCounts[repo.language] || 0) + 1;
      }
    }
    const total = Object.values(languageCounts).reduce((a, b) => a + b, 0);
    const topLanguages = Object.entries(languageCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, count]) => ({
        name,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
        color: getLanguageColor(name),
      }));

    // Calculate years on GitHub
    const createdAt = parsed.user.created_at || now();
    const yearsOnGitHub = Math.floor(
      (nowMs() - new Date(createdAt).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    );

    const totalTime = nowMs() - startTime;
    log.info(`MCP fetch complete in ${totalTime}ms`);

    const repoCount = parsed.repos?.length || 0;

    // Map repos to RepoReference format
    const repoList = (parsed.repos || []).map((repo) => {
      const parts = repo.name.includes('/') ? repo.name.split('/') : [parsed.user.login, repo.name];
      return {
        fullName: parts.join('/'),
        owner: parts[0],
        name: parts[1] || repo.name,
        language: repo.language || null,
      };
    });

    return {
      user: {
        login: parsed.user.login,
        name: parsed.user.name || null,
        avatarUrl: parsed.user.avatar_url || 'https://avatars.githubusercontent.com/u/0?v=4',
        bio: parsed.user.bio || null,
        company: parsed.user.company || null,
        location: parsed.user.location || null,
        totalRepos: repoCount,
        followers: parsed.user.followers || 0,
        following: parsed.user.following || 0,
        memberSince: new Date(createdAt).getFullYear().toString(),
      },
      stats: {
        experienceLevel: calculateExperienceLevel(
          yearsOnGitHub,
          repoCount,
          parsed.user.followers || 0
        ),
        yearsOnGitHub,
        topLanguages,
      },
      pastSevenDays: { commits: 0, pullRequests: 0, reposUpdated: 0 },
      repos: repoList,
      meta: {
        cached: false,
        aiEnabled: true,
        method: 'copilot-mcp',
        totalTimeMs: totalTime,
      },
    };
  } catch (error) {
    await loggedSession.destroy().catch(() => {});
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('MCP fetch failed:', errorMessage);
    return getFallbackResponse(startTime);
  }
}

export async function GET() {
  const startTime = nowMs();
  log.info('Request started');

  // Check if GitHub token is configured - if not, use MCP tools
  if (!(await isGitHubConfigured())) {
    log.info('GITHUB_TOKEN not configured, trying Copilot SDK MCP tools');
    return NextResponse.json(await fetchProfileViaMcp(startTime));
  }

  // Check cache first
  const cached = getCachedProfile();
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
      const events = await getUserEvents(cached.user.login, 100);
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
      },
    } satisfies ProfileResponse);
  }

  try {
    // Fetch user and repos in parallel
    log.info('Fetching user and repos...');
    const [user, repos] = await Promise.all([
      getAuthenticatedUser(),
      getUserRepositories({ perPage: 100 }),
    ]);

    // Cache the profile
    setCachedProfile(user, repos);
    log.info('Profile cached');

    const yearsOnGitHub = calculateYearsOnGitHub(user.createdAt);

    // Try to fetch activity metrics (non-blocking on failure)
    let pastSevenDays = { commits: 0, pullRequests: 0, reposUpdated: 0 };
    try {
      const events = await getUserEvents(user.login, 100);
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

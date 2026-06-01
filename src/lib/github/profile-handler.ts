/**
 * `/api/profile` request handler — pulls a multi-tenant-safe profile
 * for the authenticated user via per-request Octokit. Lives outside
 * the route file so the route stays a thin shim around guards +
 * `NextResponse.json`.
 */

import 'server-only';

import type { Octokit } from 'octokit';

import {
  calculateActivityMetrics,
  calculateExperienceLevel,
  calculateYearsOnGitHub,
  getAuthenticatedUser,
  getLanguageStats,
  getUserEvents,
  getUserRepositories,
} from '@/lib/github';
import { getOctokitForRequest } from '@/lib/github/client';
import { getCachedProfile, setCachedProfile } from '@/lib/github/profile-cache';
import type { GitHubRepo, GitHubUser } from '@/lib/github/types';
import { knownApiErrorResponse } from '@/lib/api/auth-errors';
import { logger } from '@/lib/logger';
import type { ExperienceLevel } from '@/lib/skills/types';
import { nowMs } from '@/lib/utils/date-utils';
import { NextResponse } from 'next/server';

const log = logger.withTag('Profile API');

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

const EMPTY_ACTIVITY = { commits: 0, pullRequests: 0, reposUpdated: 0 } as const;

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
    stats: { experienceLevel: 'beginner', yearsOnGitHub: 0, topLanguages: [] },
    pastSevenDays: { ...EMPTY_ACTIVITY },
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

function toRepoReference(repo: { fullName: string; language: string | null }) {
  const [owner, name] = repo.fullName.split('/');
  return { fullName: repo.fullName, owner, name, language: repo.language };
}

/**
 * Activity metrics — best-effort for transient failures, fail-closed on auth.
 *
 * @remarks
 * Activity counts are supplementary (the profile is complete without them), so
 * a transient hiccup on the events endpoint degrades to an empty tally rather
 * than failing the whole profile. A GitHub 401 is the exception: although
 * `getAuthenticatedUser` validated the token earlier in the request, the token
 * can be revoked in the window before this call (and on the cached-repo path
 * this is the only live GitHub call), so an auth failure here is rethrown and
 * converted by the callers into a 401 re-auth response rather than masked as a
 * successful profile with zero activity.
 */
async function getRecentActivity(octokit: Octokit, login: string): Promise<ProfileResponse['pastSevenDays']> {
  try {
    const events = await getUserEvents(octokit, login, 100);
    const metrics = calculateActivityMetrics(events, 7);
    return {
      commits: metrics.commits,
      pullRequests: metrics.pullRequests,
      reposUpdated: metrics.reposUpdated,
    };
  } catch (error) {
    if (isGitHubUnauthorized(error)) throw error;
    log.warn('Could not fetch activity:', error);
    return { ...EMPTY_ACTIVITY };
  }
}

interface BuildProfileInput {
  user: GitHubUser;
  repos: GitHubRepo[];
  pastSevenDays: ProfileResponse['pastSevenDays'];
  cached: boolean;
  totalTimeMs: number;
}

function buildProfileResponse(input: BuildProfileInput): ProfileResponse {
  const { user, repos, pastSevenDays, cached, totalTimeMs } = input;
  const yearsOnGitHub = calculateYearsOnGitHub(user.createdAt);

  return {
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
      experienceLevel: calculateExperienceLevel(yearsOnGitHub, repos.length, user.followers),
      yearsOnGitHub,
      topLanguages: getLanguageStats(repos),
    },
    pastSevenDays,
    repos: repos.map(toRepoReference),
    meta: {
      cached,
      aiEnabled: true,
      method: cached ? 'octokit-cached' : 'octokit-direct',
      totalTimeMs,
      authMethod: 'github-oauth',
    },
  };
}

/**
 * Resolve the per-request Octokit or return a typed error response
 * if the session token cannot be acquired. Returns `null` when the
 * error is not auth-shaped and the caller should propagate it.
 */
function octokitOrErrorResponse(error: unknown): Response | null {
  return knownApiErrorResponse(error);
}

/**
 * Detect a GitHub 401 (an expired or revoked user token). Octokit's
 * `RequestError` carries a numeric `.status`; some lower layers only surface
 * the "Bad credentials" message. Either signals that the session is no longer
 * valid, so the handler must return a real 401 — which `api-client.ts`
 * redirects to `/sign-in` — instead of masking the dead session behind
 * demo fallback data served as HTTP 200.
 */
function isGitHubUnauthorized(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 401) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('bad credentials');
}

/** The 401 response that drives the client to re-authenticate. */
function unauthorizedProfileResponse(): Response {
  return NextResponse.json({ error: 'GitHub authentication failed' }, { status: 401 });
}

/**
 * Produce the `/api/profile` response. Handles cache lookup, repo fetch,
 * activity fetch, and the static fallback. Throws only when the
 * per-request Octokit cannot be resolved due to a non-auth error.
 */
export async function handleProfileRequest(): Promise<Response> {
  const startTime = nowMs();
  log.info('Request started');

  let octokit: Octokit;
  try {
    octokit = await getOctokitForRequest();
  } catch (error) {
    const knownResponse = octokitOrErrorResponse(error);
    if (knownResponse) return knownResponse;
    throw error;
  }

  // Fetch user first so we can scope the cache by login.
  let user: GitHubUser;
  try {
    user = await getAuthenticatedUser(octokit);
  } catch (error) {
    if (isGitHubUnauthorized(error)) {
      log.warn('GitHub rejected the session token (401) fetching user; signalling re-auth');
      return unauthorizedProfileResponse();
    }
    log.error('Failed to fetch authenticated user:', error instanceof Error ? error.message : error);
    return NextResponse.json(getFallbackResponse(startTime));
  }

  const cached = getCachedProfile(user.login);
  if (cached) {
    try {
      log.info('Returning cached profile');
      const pastSevenDays = await getRecentActivity(octokit, cached.user.login);
      return NextResponse.json(
        buildProfileResponse({
          user: cached.user,
          repos: cached.repos,
          pastSevenDays,
          cached: true,
          totalTimeMs: nowMs() - startTime,
        }),
      );
    } catch (error) {
      // The cached path's only live GitHub call is activity; a 401 here means
      // the token died after `getAuthenticatedUser` succeeded, so signal
      // re-auth instead of returning stale data.
      if (isGitHubUnauthorized(error)) {
        log.warn('GitHub rejected the session token (401) fetching activity on the cached path; signalling re-auth');
        return unauthorizedProfileResponse();
      }
      throw error;
    }
  }

  try {
    log.info('Fetching repos...');
    const repos = await getUserRepositories(octokit, { perPage: 100 });
    setCachedProfile(user.login, user, repos);
    log.info('Profile cached');

    const pastSevenDays = await getRecentActivity(octokit, user.login);
    const totalTime = nowMs() - startTime;
    log.info(`Complete in ${totalTime}ms`);

    return NextResponse.json(
      buildProfileResponse({ user, repos, pastSevenDays, cached: false, totalTimeMs: totalTime }),
    );
  } catch (error) {
    const totalTime = nowMs() - startTime;
    if (isGitHubUnauthorized(error)) {
      log.warn(`GitHub rejected the session token (401) fetching repos after ${totalTime}ms; signalling re-auth`);
      return unauthorizedProfileResponse();
    }
    log.error(`Error after ${totalTime}ms:`, error instanceof Error ? error.message : error);
    return NextResponse.json(getFallbackResponse(startTime));
  }
}

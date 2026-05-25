/**
 * useUserProfile Hook
 *
 * Fetches and caches the authenticated user's GitHub profile and activity data.
 * Server-side JSON storage acts as a day-keyed cache; the React state machine
 * is provided by TanStack Query.
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';

import type { ProfileResponse } from '@/app/api/profile/route';
import { apiGet } from '@/lib/api-client';
import { logger } from '@/lib/logger';
import { getDateKey } from '@/lib/utils/date-utils';

interface UseUserProfileResult {
  data: ProfileResponse | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** Schema for profile storage API */
interface ProfileStorageSchema {
  date: string;
  profile: ProfileResponse;
}

/** Fetch cached profile from server-side storage */
async function getCachedProfile(): Promise<ProfileResponse | null> {
  try {
    const response = await fetch('/api/profile/storage');
    if (!response.ok) return null;

    const data = (await response.json()) as ProfileStorageSchema | null;
    if (!data) return null;

    if (data.date !== getDateKey()) return null;

    // Invalidate cache if it's missing authMethod (old schema)
    if (!data.profile?.meta?.authMethod) return null;

    return data.profile;
  } catch {
    return null;
  }
}

/** Save profile to server-side storage */
async function setCachedProfile(profile: ProfileResponse): Promise<void> {
  try {
    const schema: ProfileStorageSchema = {
      date: getDateKey(),
      profile,
    };
    await fetch('/api/profile/storage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(schema),
    });
  } catch {
    // Silent fail for cache writes
  }
}

const DEFAULT_AVATAR_URL = 'https://avatars.githubusercontent.com/u/0?v=4';

function normalizeProfileResponse(profile: ProfileResponse | null): ProfileResponse | null {
  if (!profile) return null;

  const userFallback: ProfileResponse['user'] = {
    login: 'unknown',
    name: null,
    avatarUrl: DEFAULT_AVATAR_URL,
    bio: null,
    company: null,
    location: null,
    totalRepos: 0,
    followers: 0,
    following: 0,
    memberSince: new Date().getFullYear().toString(),
  };

  const statsFallback: ProfileResponse['stats'] = {
    experienceLevel: 'beginner',
    yearsOnGitHub: 0,
    topLanguages: [],
  };

  const pastSevenDaysFallback: ProfileResponse['pastSevenDays'] = {
    commits: 0,
    pullRequests: 0,
    reposUpdated: 0,
  };

  const metaFallback: ProfileResponse['meta'] = {
    cached: true,
    aiEnabled: true,
    method: 'cache-normalized',
    totalTimeMs: 0,
    authMethod: 'none',
  };

  return {
    ...profile,
    user: { ...userFallback, ...profile.user },
    stats: { ...statsFallback, ...profile.stats },
    pastSevenDays: { ...pastSevenDaysFallback, ...profile.pastSevenDays },
    repos: profile.repos ?? [],
    meta: { ...metaFallback, ...profile.meta },
  };
}

/**
 * Fetch + cache the user's profile.
 *
 * @remarks
 * Cache resolution happens inside `queryFn` (not `initialData`) because
 * `getCachedProfile` is async — `initialData` requires a synchronous value.
 * Running on the client only also avoids SSR hydration mismatch.
 *
 * `meta: { bypassCache: true }` triggers a fresh API fetch (used by `refetch`).
 */
async function fetchUserProfile({ bypassCache }: { bypassCache: boolean }): Promise<ProfileResponse | null> {
  if (!bypassCache) {
    const cached = await getCachedProfile();
    if (cached) return normalizeProfileResponse(cached);
  }

  try {
    const profile = await apiGet<ProfileResponse>('/api/profile');
    const normalized = normalizeProfileResponse(profile);
    if (normalized) {
      await setCachedProfile(normalized);
    }
    return normalized;
  } catch (err) {
    logger.error(
      'Error loading profile',
      { message: err instanceof Error ? err.message : String(err) },
      'useUserProfile',
    );
    throw err;
  }
}

export function useUserProfile(): UseUserProfileResult {
  // Ref toggles to true while a manual `refetch()` is in flight, so that
  // refetch bypasses the server-side day cache and forces a fresh
  // `/api/profile` request. The ref is consumed and reset inside queryFn.
  const bypassCacheRef = useRef(false);

  const query = useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const bypassCache = bypassCacheRef.current;
      bypassCacheRef.current = false;
      return fetchUserProfile({ bypassCache });
    },
  });

  const refetch = useCallback(async () => {
    bypassCacheRef.current = true;
    await query.refetch({ cancelRefetch: true });
  }, [query]);

  return {
    data: query.data ?? null,
    isLoading: query.isFetching,
    error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load profile' : null,
    refetch,
  };
}

/**
 * Helper to get user's display name (name or username)
 */
export function getDisplayName(profile: ProfileResponse | null): string {
  if (!profile?.user) return 'Developer';
  return profile.user.name?.split(' ')[0] || profile.user.login;
}

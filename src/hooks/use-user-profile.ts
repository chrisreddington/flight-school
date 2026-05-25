/**
 * useUserProfile Hook
 *
 * Fetches and caches the authenticated user's GitHub profile and activity data.
 * Server-side JSON storage acts as a day-keyed cache; the React state machine
 * is provided by TanStack Query.
 */

'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

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
 * `bypassCache: true` is used by manual `refetch()` (routed through
 * `queryClient.fetchQuery`) to force a fresh `/api/profile` request even
 * when the day-keyed server cache is warm.
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

// Bounded staleness: the server-side day cache owns the canonical TTL
// (entries expire at midnight). A finite client-side stale window lets
// TanStack's own freshness machinery re-enter `getCachedProfile()` after
// roughly an hour of foreground activity, which catches the date-key
// rollover for long-lived tabs without flooding the cache endpoint on
// every subscriber mount. Window-focus refetches (TanStack default) cover
// users returning to the tab after midnight.
const PROFILE_STALE_TIME_MS = 60 * 60 * 1000;

export function useUserProfile(): UseUserProfileResult {
  const queryClient = useQueryClient();
  // Tracks an in-flight manual `refetch()` so `isLoading` reflects the
  // explicit cache-bypass refetch the same way it did before the TanStack
  // migration. `fetchQuery` below routes the bypass through TanStack's
  // own pipeline so success/failure both update `query.data` / `query.error`
  // for free; this state only drives the loading indicator.
  const [isManuallyRefetching, setIsManuallyRefetching] = useState(false);
  // Ref-counted concurrent-refetch guard. If a user clicks refresh twice
  // in rapid succession, call 2's `cancelQueries` aborts call 1's fetch;
  // call 1's `finally` would otherwise flip the indicator off while call 2
  // is still in flight, producing a transient `isLoading: false` flash.
  // Only the LAST in-flight refetch clears the indicator.
  const inflightRefetchCount = useRef(0);

  const query = useQuery({
    queryKey: ['profile'],
    staleTime: PROFILE_STALE_TIME_MS,
    // Explicit opt-in: the global QueryProvider disables window-focus
    // refetches, but this query needs them as the backstop that catches
    // the server-side day-cache rollover when a long-lived tab returns
    // to the foreground after midnight. The cache-check endpoint inside
    // the queryFn is a single cheap JSON read.
    refetchOnWindowFocus: true,
    queryFn: () => fetchUserProfile({ bypassCache: false }),
  });

  const refetch = useCallback(async () => {
    inflightRefetchCount.current += 1;
    setIsManuallyRefetching(true);
    try {
      // Cancel any in-flight non-bypass query for this key first.
      // Without this, `fetchQuery` would dedupe and return the existing
      // promise (which was kicked off with `bypassCache: false`), so the
      // bypass intent would be lost in the narrow window where the user
      // clicks refresh before initial mount finishes.
      await queryClient.cancelQueries({ queryKey: ['profile'] });
      // `fetchQuery` with `staleTime: 0` then runs the bypass queryFn
      // through TanStack's observer pipeline, so success populates
      // `query.data` and failure populates `query.error`.
      await queryClient.fetchQuery({
        queryKey: ['profile'],
        queryFn: () => fetchUserProfile({ bypassCache: true }),
        staleTime: 0,
      });
    } catch {
      // fetchUserProfile already logged; the error is surfaced via
      // `query.error` thanks to the fetchQuery pipeline. A rapid second
      // `refetch()` will also land here when its cancelQueries aborts
      // this call's fetchQuery — that's expected and handled by the
      // ref-counted indicator below.
    } finally {
      inflightRefetchCount.current -= 1;
      if (inflightRefetchCount.current === 0) {
        setIsManuallyRefetching(false);
      }
    }
  }, [queryClient]);

  return {
    data: query.data ?? null,
    // `isPending` (initial load only) instead of `isFetching` (every
    // background refetch) — matches the pre-migration semantics and
    // prevents loading-state flashes on subsequent subscriber mounts.
    isLoading: query.isPending || isManuallyRefetching,
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

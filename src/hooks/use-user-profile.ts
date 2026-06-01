/**
 * useUserProfile Hook
 *
 * Fetches the authenticated user's GitHub profile and activity data through
 * `/api/profile`, which validates the live GitHub token on every request. The
 * React state machine (caching, staleness, refetch) is provided by TanStack
 * Query.
 *
 * @remarks
 * There is deliberately NO client-side persistent cache here. An earlier
 * day-keyed JSON cache short-circuited `/api/profile`, so a revoked GitHub
 * token whose Auth.js session cookie was still valid kept rendering stale
 * profile data instead of redirecting to `/sign-in`. Every read now goes
 * through `/api/profile`; its 401 on a dead token is what drives
 * `api-client` to redirect. Warm reads stay fast because the server keeps a
 * short-lived in-memory repo cache behind that same token validation.
 */

'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

import type { ProfileResponse } from '@/app/api/profile/route';
import { apiGet } from '@/lib/api-client';
import { logger } from '@/lib/logger';

interface UseUserProfileResult {
  data: ProfileResponse | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
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
 * Fetch the user's profile through `/api/profile`.
 *
 * @remarks
 * Every call validates the live GitHub token server-side. There is no
 * client-side short-circuit: a dead token surfaces as a thrown error here
 * (and a 401 → `/sign-in` redirect inside `apiGet`) rather than being masked
 * by stale cached data.
 */
async function fetchUserProfile(): Promise<ProfileResponse | null> {
  try {
    const profile = await apiGet<ProfileResponse>('/api/profile');
    return normalizeProfileResponse(profile);
  } catch (err) {
    logger.error(
      'Error loading profile',
      { message: err instanceof Error ? err.message : String(err) },
      'useUserProfile',
    );
    throw err;
  }
}

// No client-side staleness window: the profile endpoint is the live
// token-validation gate, so each mount and each window-focus must re-hit it.
// `staleTime: 0` + the `'always'` refetch policies guarantee that a profile
// served from TanStack's in-memory cache on an SPA remount is revalidated
// against `/api/profile` (whose 401 → `/sign-in`) rather than trusted for up
// to an hour. TanStack dedupes concurrent observers, so simultaneous mounts
// still share a single validation request.
const PROFILE_STALE_TIME_MS = 0;

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
    // Every mount and every window-focus must revalidate the GitHub token,
    // even when TanStack already holds profile data from an earlier mount in
    // this SPA session. `'always'` (not the default `true`, which only fires
    // for STALE queries) makes the policy independent of `staleTime` so a
    // token revoked mid-session is caught on the next mount/focus.
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    queryFn: () => fetchUserProfile(),
  });

  const refetch = useCallback(async () => {
    inflightRefetchCount.current += 1;
    setIsManuallyRefetching(true);
    try {
      // Cancel any in-flight query for this key first so `fetchQuery` starts
      // a new run through TanStack's observer pipeline rather than awaiting
      // the initial-mount promise. Note the underlying `/api/profile` request
      // may still dedupe onto an in-flight one via `api-client`'s
      // pending-request map; the refetch contract is "route through the
      // pipeline so success/failure update query.data/query.error", not
      // "guarantee a brand-new socket".
      await queryClient.cancelQueries({ queryKey: ['profile'] });
      // `fetchQuery` with `staleTime: 0` then runs the queryFn through
      // TanStack's observer pipeline, so success populates `query.data`
      // and failure populates `query.error`.
      await queryClient.fetchQuery({
        queryKey: ['profile'],
        queryFn: () => fetchUserProfile(),
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

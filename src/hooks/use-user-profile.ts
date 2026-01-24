/**
 * useUserProfile Hook
 * 
 * Fetches and caches the authenticated user's GitHub profile and activity data.
 * Uses server-side JSON storage for day-based persistence with manual refresh capability.
 */

import { useCallback, useEffect, useState } from 'react';

import type { ProfileResponse } from '@/app/api/profile/route';
import { apiGet } from '@/lib/api-client';
import { logger } from '@/lib/logger';
import { getDateKey } from '@/lib/utils/date-utils';

export interface UseUserProfileResult {
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
    
    const data = await response.json() as ProfileStorageSchema | null;
    if (!data) return null;
    
    // Check if cache is from today
    const todayKey = getDateKey();
    if (data.date !== todayKey) return null;
    
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

export function useUserProfile(): UseUserProfileResult {
  // SSR-safe: Always start with null/loading state for consistent hydration
  // Cache is checked in useEffect after hydration completes
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async (bypassCache = false) => {
    // Check cache validity (from today)
    if (!bypassCache) {
      const cached = await getCachedProfile();
      if (cached) {
        const normalized = normalizeProfileResponse(cached);
        setData(normalized);
        setIsLoading(false);
        return;
      }
    }

    setIsLoading(true);
    setError(null);

    try {
      // Use centralized API client with automatic retry and error handling
      const profile = await apiGet<ProfileResponse>('/api/profile');
      const normalized = normalizeProfileResponse(profile);
      
      // Save to server-side storage
      if (normalized) {
        await setCachedProfile(normalized);
      }
      
      setData(normalized);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load profile';
      setError(message);
      logger.error('Error loading profile', { message }, 'useUserProfile');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refetch = useCallback(async () => {
    await fetchProfile(true);
  }, [fetchProfile]);

  // Check cache after hydration to avoid SSR mismatch
  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  return { data, isLoading, error, refetch };
}

/**
 * Helper to get user's display name (name or username)
 */
export function getDisplayName(profile: ProfileResponse | null): string {
  if (!profile?.user) return 'Developer';
  return profile.user.name?.split(' ')[0] || profile.user.login;
}

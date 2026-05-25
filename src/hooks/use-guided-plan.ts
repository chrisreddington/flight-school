'use client';

import { apiPost } from '@/lib/api-client';
import type { GuidedPlan } from '@/lib/copilot/guided-mode-types';
import { getGuidedPlanFallback } from '@/lib/copilot/guided-mode-types';
import { useQuery } from '@tanstack/react-query';

const CACHE_PREFIX = 'guided-plan:';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedGuidedPlan {
  plan: GuidedPlan;
  cachedAt: number;
}

function readCache(challengeId: string): CachedGuidedPlan | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${challengeId}`);
    if (!raw) return null;
    const cached: CachedGuidedPlan = JSON.parse(raw);
    if (Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached;
  } catch {
    // localStorage unavailable or corrupted
  }
  return null;
}

function writeCache(challengeId: string, plan: GuidedPlan): void {
  try {
    const entry: CachedGuidedPlan = { plan, cachedAt: Date.now() };
    localStorage.setItem(`${CACHE_PREFIX}${challengeId}`, JSON.stringify(entry));
  } catch {
    // Quota exceeded or unavailable — silently skip
  }
}

/**
 * Pre-fetches and caches the AI-generated guided plan for a challenge.
 *
 * Starts fetching immediately on mount (before the user clicks "Guided Mode"),
 * so the plan is ready by the time they open the panel. Successful responses
 * are persisted in localStorage for 24 hours; the localStorage check happens
 * inside `queryFn` (not via `initialData`) so SSR and client hydration stay
 * aligned. Errors do NOT poison the cache — the hook surfaces a static
 * fallback derived from the challenge metadata while leaving the TanStack
 * query in an error state, so a remount/back-navigation can retry the AI
 * request.
 *
 * @param challengeId - Used as the localStorage cache key
 * @param challenge - Challenge metadata for the AI prompt
 */
export function useGuidedPlan(
  challengeId: string,
  challenge: { title: string; description: string; language: string; difficulty: string },
) {
  const query = useQuery<GuidedPlan>({
    queryKey: ['guided-plan', challengeId],
    staleTime: CACHE_TTL_MS,
    gcTime: CACHE_TTL_MS,
    queryFn: async () => {
      const cached = readCache(challengeId);
      if (cached) return cached.plan;

      const data = await apiPost<GuidedPlan>('/api/guided-plan', {
        challengeTitle: challenge.title,
        challengeDescription: challenge.description,
        challengeLanguage: challenge.language,
        challengeDifficulty: challenge.difficulty,
      });
      writeCache(challengeId, data);
      return data;
      // Errors propagate to query.error. The static fallback is derived
      // outside the query so failed fetches don't suppress retries by
      // looking like fresh successful 24h-cached data.
    },
  });

  const plan = query.data ?? (query.isError ? getGuidedPlanFallback(challenge) : null);

  return { plan, loading: query.isPending };
}

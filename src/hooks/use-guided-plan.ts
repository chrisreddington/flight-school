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
 * so the plan is ready by the time they open the panel. Results are persisted
 * in localStorage for 24 hours and mirrored into the TanStack Query cache for
 * the lifetime of the page. The localStorage check happens inside `queryFn`
 * (not via `initialData`) so SSR and client hydration stay aligned and the
 * cache freshness clock starts at the original cache-write time.
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

      try {
        const data = await apiPost<GuidedPlan>('/api/guided-plan', {
          challengeTitle: challenge.title,
          challengeDescription: challenge.description,
          challengeLanguage: challenge.language,
          challengeDifficulty: challenge.difficulty,
        });
        writeCache(challengeId, data);
        return data;
      } catch {
        // 402 already broadcast to the banner via apiPost; fall back to
        // the static plan for this view.
        return getGuidedPlanFallback(challenge);
      }
    },
  });

  return { plan: query.data ?? null, loading: query.isPending };
}

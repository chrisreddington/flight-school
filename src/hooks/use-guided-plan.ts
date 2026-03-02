'use client';

import type { GuidedPlan } from '@/lib/copilot/guided-mode-types';
import { getGuidedPlanFallback } from '@/lib/copilot/guided-mode-types';
import { useEffect, useState } from 'react';

const CACHE_PREFIX = 'guided-plan:';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedGuidedPlan {
  plan: GuidedPlan;
  cachedAt: number;
}

function readCache(challengeId: string): GuidedPlan | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${challengeId}`);
    if (!raw) return null;
    const cached: CachedGuidedPlan = JSON.parse(raw);
    if (Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.plan;
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
 * in localStorage for 24 hours to avoid redundant AI calls.
 *
 * @param challengeId - Used as the localStorage cache key
 * @param challenge - Challenge metadata for the AI prompt
 */
export function useGuidedPlan(
  challengeId: string,
  challenge: { title: string; description: string; language: string; difficulty: string }
) {
  const [plan, setPlan] = useState<GuidedPlan | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // Serve from cache immediately — no loading flash
    const cached = readCache(challengeId);
    if (cached) {
      setPlan(cached);
      setLoading(false);
      return;
    }

    // No cache: fetch in background while user reads the challenge
    (async () => {
      try {
        const response = await fetch('/api/guided-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            challengeTitle: challenge.title,
            challengeDescription: challenge.description,
            challengeLanguage: challenge.language,
            challengeDifficulty: challenge.difficulty,
          }),
        });
        const data = (await response.json()) as GuidedPlan;
        const result = response.ok ? data : getGuidedPlanFallback(challenge);
        writeCache(challengeId, result);
        if (mounted) setPlan(result);
      } catch {
        if (mounted) setPlan(getGuidedPlanFallback(challenge));
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [challengeId, challenge]);

  return { plan, loading };
}

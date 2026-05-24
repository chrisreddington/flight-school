/**
 * useSpacedRepCandidates Hook
 *
 * Surfaces up to three high-priority topics due for spaced-repetition
 * review based on the user's focus history. Built on top of
 * `useStoreQuery` for the load/error/unmount-safety machinery.
 */

'use client';

import { focusStore } from '@/lib/focus';
import { getSpacedRepCandidates, type SpacedRepCandidate } from '@/lib/focus/spaced-repetition';

import { useStoreQuery } from './use-store-query';

interface UseSpacedRepCandidatesResult {
  candidates: SpacedRepCandidate[];
  isLoading: boolean;
}

const MAX_CANDIDATES = 3;
const MIN_DAYS_SINCE_SEEN = 1;
const EMPTY_CANDIDATES: SpacedRepCandidate[] = [];

export function useSpacedRepCandidates(): UseSpacedRepCandidatesResult {
  const { data: candidates, isLoading } = useStoreQuery<SpacedRepCandidate[]>(
    async () => {
      const history = await focusStore.getHistory();
      return getSpacedRepCandidates(history)
        .filter((candidate) => candidate.daysSinceSeen >= MIN_DAYS_SINCE_SEEN)
        .sort((a, b) => b.priority - a.priority || b.daysSinceSeen - a.daysSinceSeen)
        .slice(0, MAX_CANDIDATES);
    },
    { initialValue: EMPTY_CANDIDATES },
  );

  return { candidates, isLoading };
}

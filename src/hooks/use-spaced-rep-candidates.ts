/**
 * useSpacedRepCandidates Hook
 *
 * Surfaces up to three high-priority topics due for spaced-repetition
 * review based on the user's focus history.
 */

'use client';

import { useQuery } from '@tanstack/react-query';

import { focusStore } from '@/lib/focus';
import { getSpacedRepCandidates, type SpacedRepCandidate } from '@/lib/focus/spaced-repetition';

interface UseSpacedRepCandidatesResult {
  candidates: SpacedRepCandidate[];
  isLoading: boolean;
}

const MAX_CANDIDATES = 3;
const MIN_DAYS_SINCE_SEEN = 1;
const EMPTY_CANDIDATES: SpacedRepCandidate[] = [];

async function loadSpacedRepCandidates(): Promise<SpacedRepCandidate[]> {
  const history = await focusStore.getHistory();
  return getSpacedRepCandidates(history)
    .filter((candidate) => candidate.daysSinceSeen >= MIN_DAYS_SINCE_SEEN)
    .sort((a, b) => b.priority - a.priority || b.daysSinceSeen - a.daysSinceSeen)
    .slice(0, MAX_CANDIDATES);
}

export function useSpacedRepCandidates(): UseSpacedRepCandidatesResult {
  const { data, isLoading } = useQuery({
    queryKey: ['spaced-rep-candidates'],
    queryFn: loadSpacedRepCandidates,
  });
  return { candidates: data ?? EMPTY_CANDIDATES, isLoading };
}

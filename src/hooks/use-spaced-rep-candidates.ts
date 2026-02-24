'use client';

import { useEffect, useState } from 'react';

import { focusStore } from '@/lib/focus';
import { getSpacedRepCandidates, type SpacedRepCandidate } from '@/lib/focus/spaced-repetition';

interface UseSpacedRepCandidatesResult {
  candidates: SpacedRepCandidate[];
  isLoading: boolean;
}

export function useSpacedRepCandidates(): UseSpacedRepCandidatesResult {
  const [candidates, setCandidates] = useState<SpacedRepCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    const loadCandidates = async () => {
      setIsLoading(true);
      try {
        const history = await focusStore.getHistory();
        const dueCandidates = getSpacedRepCandidates(history)
          .filter((candidate) => candidate.daysSinceSeen >= 1)
          .sort((a, b) => b.priority - a.priority || b.daysSinceSeen - a.daysSinceSeen)
          .slice(0, 3);

        if (!isActive) return;
        setCandidates(dueCandidates);
      } catch {
        if (!isActive) return;
        setCandidates([]);
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void loadCandidates();

    return () => {
      isActive = false;
    };
  }, []);

  return { candidates, isLoading };
}

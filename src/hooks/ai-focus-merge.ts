import type { FocusResponse } from '@/lib/focus/types';
import { now } from '@/lib/utils/date-utils';

type FocusComponent = 'challenge' | 'goal' | 'learningTopics';

/**
 * Folds a single component's response into a prior FocusResponse (storage or
 * React state). Missing fields fall back to placeholders so the merged shape
 * is always renderable — callers decide via {@link isFocusReadyToPersist}
 * whether placeholders mean the merge is safe to write to storage.
 */
export function mergeFocusComponent(
  prev: FocusResponse | null,
  componentResult: Partial<FocusResponse>,
  component: FocusComponent
): FocusResponse {
  const challenge =
    component === 'challenge' && componentResult.challenge
      ? componentResult.challenge
      : prev?.challenge;
  const goal =
    component === 'goal' && componentResult.goal ? componentResult.goal : prev?.goal;
  const learningTopics =
    component === 'learningTopics' && componentResult.learningTopics
      ? componentResult.learningTopics
      : prev?.learningTopics;

  return {
    challenge: challenge || {
      id: '',
      title: '',
      description: '',
      difficulty: 'intermediate',
      language: '',
      estimatedTime: '',
      whyThisChallenge: [],
    },
    goal: goal || { id: '', title: '', description: '', progress: 0, target: '', reasoning: '' },
    learningTopics: learningTopics || [],
    meta: componentResult.meta ||
      prev?.meta || {
        generatedAt: now(),
        aiEnabled: true,
        model: 'gpt-5-mini',
        toolsUsed: [],
        totalTimeMs: 0,
        usedCachedProfile: true,
      },
    calibrationNeeded: componentResult.calibrationNeeded || prev?.calibrationNeeded,
  };
}

/**
 * Returns true only when every focus component has real data. We avoid
 * persisting partial merges because they surface as blank history entries.
 */
export function isFocusReadyToPersist(merged: FocusResponse): boolean {
  return Boolean(
    merged.challenge?.id &&
      merged.challenge?.title &&
      merged.goal?.id &&
      merged.goal?.title &&
      merged.learningTopics?.length
  );
}

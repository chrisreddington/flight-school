/**
 * useFocusSkip
 *
 * Encapsulates the three "skip and regenerate" flows for the daily focus
 * (topic / challenge / goal). Each flow starts a background job via the
 * operations manager and refreshes data from storage on completion.
 *
 * @remarks
 * Extracted from `useAIFocus` to keep the main hook focused on
 * fetch/merge logic. The internal `currentSkipping*IdRef` refs are kept
 * here so `stopAll` can cancel any in-flight regeneration without the
 * caller needing to track ids.
 */

import { useCallback, useRef } from 'react';

import { focusStore } from '@/lib/focus';
import type { DailyChallenge, DailyGoal, FocusResponse, LearningTopic } from '@/lib/focus/types';
import { logger } from '@/lib/logger';
import { createAiFocusSkipTrigger } from '@/lib/observability/job-trigger-builders';
import { operationsManager } from '@/lib/operations';
import { getDateKey } from '@/lib/utils/date-utils';
import type { SkillProfile } from '@/lib/skills/types';

const log = logger.withTag('useFocusSkip');

/**
 * Result of {@link useFocusSkip}: skip/replace + stop callbacks plus a
 * `cancelAllSkips` helper used by the parent hook's `stopAll`.
 */
export interface UseFocusSkipResult {
  skipAndReplaceTopic: (skippedTopicId: string, existingTopicTitles: string[]) => Promise<void>;
  skipAndReplaceChallenge: (skippedChallengeId: string, existingChallengeTitles: string[]) => Promise<void>;
  skipAndReplaceGoal: (skippedGoalId: string, existingGoalTitles: string[]) => Promise<void>;
  stopTopicSkip: (topicId: string) => void;
  stopChallengeSkip: (challengeId: string) => void;
  stopGoalSkip: (goalId: string) => void;
  /** Cancel any in-flight skip operation (used by stopAll). */
  cancelAllSkips: () => void;
}

/**
 * @param getSkillProfile - resolver for the current SkillProfile (returns
 *   the default profile when storage is unavailable).
 * @param setData - state setter from the parent hook so we can push the
 *   refreshed focus back into UI state when a regeneration completes.
 */
export function useFocusSkip(
  getSkillProfile: () => Promise<SkillProfile>,
  setData: (focus: FocusResponse) => void,
): UseFocusSkipResult {
  const currentSkippingTopicIdRef = useRef<string | null>(null);
  const currentSkippingChallengeIdRef = useRef<string | null>(null);
  const currentSkippingGoalIdRef = useRef<string | null>(null);

  const refreshFromStorage = useCallback(async () => {
    const currentFocus = await focusStore.getTodaysFocus();
    if (currentFocus) setData(currentFocus);
  }, [setData]);

  const skipAndReplaceTopic = useCallback(
    async (skippedTopicId: string, existingTopicTitles: string[]) => {
      currentSkippingTopicIdRef.current = skippedTopicId;
      const skillProfile = await getSkillProfile();
      const dateKey = getDateKey();
      // Capture the slot index BEFORE skipping so the replacement can land in-place.
      const position = await focusStore.getTopicPosition(dateKey, skippedTopicId);

      operationsManager.startBackgroundJob<{ learningTopic: LearningTopic }>({
        type: 'topic-regeneration',
        targetId: skippedTopicId,
        input: {
          existingTopicTitles,
          skillProfile: skillProfile?.skills.length ? skillProfile : undefined,
          position,
        },
        clientTrigger: createAiFocusSkipTrigger('topic', skippedTopicId),
        onComplete: async (result) => {
          if (!result?.learningTopic) {
            log.warn('Topic regeneration completed but no topic returned');
            return;
          }
          await refreshFromStorage();
          currentSkippingTopicIdRef.current = null;
        },
        onError: (err) => {
          log.error('Failed to generate replacement topic:', err);
          currentSkippingTopicIdRef.current = null;
        },
      });
    },
    [getSkillProfile, refreshFromStorage],
  );

  const skipAndReplaceChallenge = useCallback(
    async (skippedChallengeId: string, existingChallengeTitles: string[]) => {
      currentSkippingChallengeIdRef.current = skippedChallengeId;
      const skillProfile = await getSkillProfile();

      operationsManager.startBackgroundJob<{ challenge: DailyChallenge }>({
        type: 'challenge-regeneration',
        targetId: skippedChallengeId,
        input: {
          existingChallengeTitles,
          skillProfile: skillProfile?.skills.length ? skillProfile : undefined,
        },
        clientTrigger: createAiFocusSkipTrigger('challenge', skippedChallengeId),
        onComplete: async (result) => {
          if (!result?.challenge) {
            log.warn('Challenge regeneration completed but no challenge returned');
            return;
          }
          await refreshFromStorage();
          currentSkippingChallengeIdRef.current = null;
        },
        onError: (err) => {
          log.error('Failed to generate replacement challenge:', err);
          currentSkippingChallengeIdRef.current = null;
        },
      });
    },
    [getSkillProfile, refreshFromStorage],
  );

  const skipAndReplaceGoal = useCallback(
    async (skippedGoalId: string, existingGoalTitles: string[]) => {
      currentSkippingGoalIdRef.current = skippedGoalId;
      const skillProfile = await getSkillProfile();

      operationsManager.startBackgroundJob<{ goal: DailyGoal }>({
        type: 'goal-regeneration',
        targetId: skippedGoalId,
        input: {
          existingGoalTitles,
          skillProfile: skillProfile?.skills.length ? skillProfile : undefined,
        },
        clientTrigger: createAiFocusSkipTrigger('goal', skippedGoalId),
        onComplete: async (result) => {
          if (!result?.goal) {
            log.warn('Goal regeneration completed but no goal returned');
            return;
          }
          await refreshFromStorage();
          currentSkippingGoalIdRef.current = null;
        },
        onError: (err) => {
          log.error('Failed to generate replacement goal:', err);
          currentSkippingGoalIdRef.current = null;
        },
      });
    },
    [getSkillProfile, refreshFromStorage],
  );

  const stopTopicSkip = useCallback((topicId: string) => {
    operationsManager.cancelBackgroundJob(`topic-regeneration:${topicId}`);
  }, []);

  const stopChallengeSkip = useCallback((challengeId: string) => {
    operationsManager.cancelBackgroundJob(`challenge-regeneration:${challengeId}`);
  }, []);

  const stopGoalSkip = useCallback((goalId: string) => {
    operationsManager.cancelBackgroundJob(`goal-regeneration:${goalId}`);
  }, []);

  const cancelAllSkips = useCallback(() => {
    const topicId = currentSkippingTopicIdRef.current;
    if (topicId) {
      operationsManager.cancelBackgroundJob(`topic-regeneration:${topicId}`);
      currentSkippingTopicIdRef.current = null;
    }
    const challengeId = currentSkippingChallengeIdRef.current;
    if (challengeId) {
      operationsManager.cancelBackgroundJob(`challenge-regeneration:${challengeId}`);
      currentSkippingChallengeIdRef.current = null;
    }
    const goalId = currentSkippingGoalIdRef.current;
    if (goalId) {
      operationsManager.cancelBackgroundJob(`goal-regeneration:${goalId}`);
      currentSkippingGoalIdRef.current = null;
    }
  }, []);

  return {
    skipAndReplaceTopic,
    skipAndReplaceChallenge,
    skipAndReplaceGoal,
    stopTopicSkip,
    stopChallengeSkip,
    stopGoalSkip,
    cancelAllSkips,
  };
}

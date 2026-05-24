/**
 * useAIFocus Hook
 *
 * Fetches AI-generated daily focus content with progressive loading. Makes
 * three parallel API requests (challenge, goal, learningTopics) and merges
 * each result into the React + persistent stores as it arrives.
 *
 * @remarks
 * Skip-and-regenerate flows live in {@link useFocusSkip}; storage refresh
 * subscriptions live in {@link useFocusStorageSubscriptions}.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { apiPost } from '@/lib/api-client';
import { focusStore } from '@/lib/focus';
import type { FocusResponse } from '@/lib/focus/types';
import { logger } from '@/lib/logger';
import { skillsStore } from '@/lib/skills/storage';
import { DEFAULT_SKILL_PROFILE, type SkillProfile } from '@/lib/skills/types';
import { formatTimestamp } from '@/lib/utils/date-utils';

import { isFocusReadyToPersist, mergeFocusComponent } from './ai-focus-merge';
import { useFocusSkip } from './use-focus-skip';
import { useFocusStorageSubscriptions } from './use-focus-storage-subscriptions';
import { useOperationRegenerations } from './use-operation-regenerations';

const log = logger.withTag('useAIFocus');

type FocusComponent = 'challenge' | 'goal' | 'learningTopics';

async function getSkillProfileSafe(): Promise<SkillProfile> {
  if (typeof window === 'undefined') return DEFAULT_SKILL_PROFILE;
  try {
    return await skillsStore.get();
  } catch {
    return DEFAULT_SKILL_PROFILE;
  }
}

interface UseAIFocusResult {
  data: FocusResponse | null;
  loadingComponents: FocusComponent[];
  error: string | null;
  isAIEnabled: boolean;
  toolsUsed: string[];
  refetch: (component?: FocusComponent) => Promise<void>;
  skipAndReplaceTopic: (skippedTopicId: string, existingTopicTitles: string[]) => Promise<void>;
  skipAndReplaceChallenge: (skippedChallengeId: string, existingChallengeTitles: string[]) => Promise<void>;
  requestDebugChallenge: () => Promise<void>;
  skipAndReplaceGoal: (skippedGoalId: string, existingGoalTitles: string[]) => Promise<void>;
  skippingTopicIds: Set<string>;
  skippingChallengeIds: Set<string>;
  skippingGoalIds: Set<string>;
  generatedAt: string | null;
  generatedAtFormatted: string | null;
  componentTimestamps: Record<FocusComponent, string | null>;
  isNewDay: boolean;
  stopComponent: (component: FocusComponent | 'singleTopic') => void;
  stopTopicSkip: (topicId: string) => void;
  stopChallengeSkip: (challengeId: string) => void;
  stopGoalSkip: (goalId: string) => void;
  stopAll: () => void;
}

export function useAIFocus(): UseAIFocusResult {
  const [data, setData] = useState<FocusResponse | null>(null);
  const [loadingComponents, setLoadingComponents] = useState<FocusComponent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isNewDay, setIsNewDay] = useState(false);
  const hasFetchedRef = useRef(false);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  // Cross-component visibility: surface in-flight regenerations even after
  // the user navigates away and back. Owned by the shared hook so the focus
  // page and history page see the same sets.
  const { skippingTopicIds, skippingChallengeIds, skippingGoalIds } = useOperationRegenerations();

  const skip = useFocusSkip(getSkillProfileSafe, setData);

  const stopComponent = useCallback((component: FocusComponent | 'singleTopic') => {
    const controller = abortControllersRef.current.get(component);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(component);
    }
    setLoadingComponents((prev) => prev.filter((c) => c !== component));
  }, []);

  const stopAll = useCallback(() => {
    for (const [key, controller] of abortControllersRef.current) {
      controller.abort();
      abortControllersRef.current.delete(key);
    }
    setLoadingComponents([]);
    skip.cancelAllSkips();
  }, [skip]);

  const fetchComponent = useCallback(
    async (
      component: FocusComponent,
      skillProfile?: SkillProfile,
      options?: { debugMode?: boolean },
    ): Promise<Partial<FocusResponse> | null> => {
      stopComponent(component);

      const controller = new AbortController();
      abortControllersRef.current.set(component, controller);

      try {
        setLoadingComponents((prev) => [...prev.filter((c) => c !== component), component]);
        return await apiPost<Partial<FocusResponse>>(
          '/api/focus',
          {
            component,
            skillProfile: skillProfile?.skills.length ? skillProfile : undefined,
            ...(options?.debugMode ? { debugMode: true } : {}),
          },
          { timeout: 60000, signal: controller.signal },
        );
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          log.debug(`Fetch for ${component} was cancelled`);
          return null;
        }
        log.error(`Failed to fetch ${component}:`, err);
        return null;
      } finally {
        abortControllersRef.current.delete(component);
        setLoadingComponents((prev) => prev.filter((c) => c !== component));
      }
    },
    [stopComponent],
  );

  const mergeAndSave = useCallback(
    async (componentResult: Partial<FocusResponse>, component: FocusComponent) => {
      // Storage may hold data from components that finished while this one was
      // generating; React state holds the in-session merges. Both must be
      // consulted before we write back.
      const storedData = await focusStore.getTodaysFocus();

      setData((reactState) => {
        const merged = mergeFocusComponent(storedData || reactState, componentResult, component);

        if (isFocusReadyToPersist(merged)) {
          focusStore.saveTodaysFocus(merged).catch((err) => {
            log.error('Failed to save focus:', err);
          });
        }

        return merged;
      });
    },
    [],
  );

  const fetchAllParallel = useCallback(async () => {
    const skillProfile = await getSkillProfileSafe();
    const components: FocusComponent[] = ['challenge', 'goal', 'learningTopics'];

    setLoadingComponents(components);
    setError(null);

    const promises = components.map(async (component) => {
      const result = await fetchComponent(component, skillProfile);
      if (result) {
        await mergeAndSave(result, component);
      }
      return { component, result };
    });

    const results = await Promise.allSettled(promises);
    const allFailed = results.every(
      (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.result),
    );

    if (allFailed) {
      setError('Failed to load focus content');
      const cached = await focusStore.getTodaysFocus();
      if (cached) setData(cached);
    }

    setIsNewDay(false);
  }, [fetchComponent, mergeAndSave]);

  const refetch = useCallback(
    async (component?: FocusComponent) => {
      const skillProfile = await getSkillProfileSafe();
      if (component) {
        const result = await fetchComponent(component, skillProfile);
        if (result) await mergeAndSave(result, component);
      } else {
        await fetchAllParallel();
      }
    },
    [fetchComponent, mergeAndSave, fetchAllParallel],
  );

  const requestDebugChallenge = useCallback(async () => {
    const skillProfile = await getSkillProfileSafe();
    const challengeResult = await fetchComponent('challenge', skillProfile, { debugMode: true });
    if (challengeResult?.challenge) {
      await mergeAndSave(challengeResult, 'challenge');
    }
  }, [fetchComponent, mergeAndSave]);

  const refreshFromStorage = useCallback(async (): Promise<boolean> => {
    const cached = await focusStore.getTodaysFocus();
    if (cached) {
      setData(cached);
      log.debug('Refreshed data from storage');
      return true;
    }
    return false;
  }, []);

  // Initial mount: read cache first to handle returning-from-navigation;
  // only fetch fresh data on genuinely new days.
  useEffect(() => {
    const loadInitialData = async () => {
      const cached = await focusStore.getTodaysFocus();
      const newDay = await focusStore.isNewDay();
      setIsNewDay(newDay);

      if (cached && !newDay) {
        setData(cached);
        setLoadingComponents([]);
        hasFetchedRef.current = true;
      } else if (!hasFetchedRef.current) {
        hasFetchedRef.current = true;
        await fetchAllParallel();
      }
    };

    loadInitialData();
  }, [fetchAllParallel]);

  useFocusStorageSubscriptions(refreshFromStorage);

  const generatedAt = data?.meta.generatedAt ?? null;

  return {
    data,
    loadingComponents,
    error,
    isAIEnabled: data?.meta.aiEnabled ?? false,
    toolsUsed: data?.meta.toolsUsed ?? [],
    refetch,
    skipAndReplaceTopic: skip.skipAndReplaceTopic,
    skipAndReplaceChallenge: skip.skipAndReplaceChallenge,
    requestDebugChallenge,
    skipAndReplaceGoal: skip.skipAndReplaceGoal,
    skippingTopicIds,
    skippingChallengeIds,
    skippingGoalIds,
    generatedAt,
    generatedAtFormatted: generatedAt ? formatTimestamp(generatedAt) : null,
    componentTimestamps: {
      challenge: null,
      goal: null,
      learningTopics: null,
    },
    isNewDay,
    stopComponent,
    stopTopicSkip: skip.stopTopicSkip,
    stopChallengeSkip: skip.stopChallengeSkip,
    stopGoalSkip: skip.stopGoalSkip,
    stopAll,
  };
}

/**
 * useAIFocus Hook
 *
 * Fetches AI-generated daily focus content with progressive loading.
 * Makes 3 parallel API requests (challenge, goal, learningTopics) for faster UX.
 *
 * Features:
 * - Progressive rendering: each component loads independently
 * - Parallel API calls: ~15s per component vs ~60s for all
 * - Persists to server-side storage
 * - Automatic day-based cache refresh
 */

import { apiPost } from '@/lib/api-client';
import { focusStore } from '@/lib/focus';
import type { FocusResponse, LearningTopic } from '@/lib/focus/types';
import { logger } from '@/lib/logger';
import { operationsManager } from '@/lib/operations';
import { formatTimestamp, getDateKey, now } from '@/lib/utils/date-utils';
import { skillsStore } from '@/lib/skills/storage';
import type { SkillProfile } from '@/lib/skills/types';
import { DEFAULT_SKILL_PROFILE } from '@/lib/skills/types';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

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

export interface UseAIFocusResult {
  data: FocusResponse | null;
  loadingComponents: FocusComponent[];
  error: string | null;
  isAIEnabled: boolean;
  toolsUsed: string[];
  refetch: (component?: FocusComponent) => Promise<void>;
  /** Skip a single topic and regenerate a replacement */
  skipAndReplaceTopic: (skippedTopicId: string, existingTopicTitles: string[]) => Promise<void>;
  /** Set of topic IDs currently being skipped/regenerated */
  skippingTopicIds: Set<string>;
  generatedAt: string | null;
  generatedAtFormatted: string | null;
  componentTimestamps: Record<FocusComponent, string | null>;
  isNewDay: boolean;
  /** Stop a specific component's AI generation */
  stopComponent: (component: FocusComponent | 'singleTopic') => void;
  /** Stop topic skip - topic returns to original state since it was never marked as skipped */
  stopTopicSkip: () => void;
  /** Stop all AI generation */
  stopAll: () => void;
}

export function useAIFocus(): UseAIFocusResult {
  const [data, setData] = useState<FocusResponse | null>(null);
  const [loadingComponents, setLoadingComponents] = useState<FocusComponent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isNewDay, setIsNewDay] = useState(false);
  const hasFetchedRef = useRef(false);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  // Track which topic ID is currently being skipped so we can revert on stop
  const currentSkippingTopicIdRef = useRef<string | null>(null);

  // Subscribe to global operations manager for cross-component visibility
  // This allows FocusHistory to show loading states when user navigates away
  const skippingTopicIds = useSyncExternalStore(
    operationsManager.subscribe.bind(operationsManager),
    () => operationsManager.getActiveIdsOfType('topic-regeneration'),
    () => new Set<string>() // SSR fallback
  );

  /** Stop/cancel a specific component's fetch */
  const stopComponent = useCallback((component: FocusComponent | 'singleTopic') => {
    const controller = abortControllersRef.current.get(component);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(component);
    }
    setLoadingComponents(prev => prev.filter(c => c !== component));
  }, []);

  /** Stop topic skip - topic was never marked as skipped so no revert needed */
  const stopTopicSkip = useCallback(() => {
    // Abort via operations manager
    const topicId = currentSkippingTopicIdRef.current;
    if (topicId) {
      operationsManager.abort(`topic-regen:${topicId}`);
    }
    currentSkippingTopicIdRef.current = null;
  }, []);

  /** Stop all in-flight fetches */
  const stopAll = useCallback(() => {
    for (const [key, controller] of abortControllersRef.current) {
      controller.abort();
      abortControllersRef.current.delete(key);
    }
    setLoadingComponents([]);
    // Also abort any topic regeneration via operations manager
    const topicId = currentSkippingTopicIdRef.current;
    if (topicId) {
      operationsManager.abort(`topic-regen:${topicId}`);
      currentSkippingTopicIdRef.current = null;
    }
  }, []);

  /** Fetch a single component */
  const fetchComponent = useCallback(async (
    component: FocusComponent,
    skillProfile?: SkillProfile
  ): Promise<Partial<FocusResponse> | null> => {
    // Cancel any existing fetch for this component
    stopComponent(component);
    
    const controller = new AbortController();
    abortControllersRef.current.set(component, controller);
    
    try {
      setLoadingComponents(prev => [...prev.filter(c => c !== component), component]);
      
      const result = await apiPost<Partial<FocusResponse>>('/api/focus', {
        component,
        skillProfile: skillProfile?.skills.length ? skillProfile : undefined,
      }, { timeout: 60000, signal: controller.signal });
      
      return result;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        log.debug(`Fetch for ${component} was cancelled`);
        return null;
      }
      log.error(`Failed to fetch ${component}:`, err);
      return null;
    } finally {
      abortControllersRef.current.delete(component);
      setLoadingComponents(prev => prev.filter(c => c !== component));
    }
  }, [stopComponent]);

  /** Merge a component result into current data and save */
  const mergeAndSave = useCallback(async (
    componentResult: Partial<FocusResponse>,
    component: FocusComponent
  ) => {
    // Get current data from both storage AND React state
    // Storage may have data from other components that finished while we were generating
    // React state has data from components that finished in this session
    const storedData = await focusStore.getTodaysFocus();
    
    // Use setData with callback to get latest React state AND merge results
    setData(reactState => {
      // Merge storage + React state (storage takes precedence if exists)
      const prev = storedData || reactState;
      
      // Get the new or existing value for each component
      const challenge = component === 'challenge' && componentResult.challenge 
        ? componentResult.challenge 
        : prev?.challenge;
      const goal = component === 'goal' && componentResult.goal
        ? componentResult.goal
        : prev?.goal;
      const learningTopics = component === 'learningTopics' && componentResult.learningTopics
        ? componentResult.learningTopics
        : prev?.learningTopics;
      
      // Only save if we have all required components with valid data
      // This prevents saving empty placeholder objects that create blank entries
      const hasValidChallenge = challenge && challenge.id && challenge.title;
      const hasValidGoal = goal && goal.id && goal.title;
      const hasValidTopics = learningTopics && learningTopics.length > 0;
      
      const merged: FocusResponse = {
        challenge: challenge || { id: '', title: '', description: '', difficulty: 'intermediate', language: '', estimatedTime: '', whyThisChallenge: [] },
        goal: goal || { id: '', title: '', description: '', progress: 0, target: '', reasoning: '' },
        learningTopics: learningTopics || [],
        meta: componentResult.meta || prev?.meta || {
          generatedAt: now(),
          aiEnabled: true,
          model: 'gpt-5-mini',
          toolsUsed: [],
          totalTimeMs: 0,
          usedCachedProfile: true,
        },
        calibrationNeeded: componentResult.calibrationNeeded || prev?.calibrationNeeded,
      };
      
      // Persist to storage (async, fire-and-forget from state update)
      if (hasValidChallenge && hasValidGoal && hasValidTopics) {
        focusStore.saveTodaysFocus(merged).then(() => {
          log.debug(`Component ${component} saved to storage`);
        }).catch(err => {
          log.error('Failed to save focus:', err);
        });
      } else {
        log.debug(`Component ${component} merged but not saved yet (waiting for all components)`, {
          hasValidChallenge: !!hasValidChallenge,
          hasValidGoal: !!hasValidGoal,
          hasValidTopics: !!hasValidTopics,
        });
      }
      
      return merged;
    });
  }, []);

  /** Fetch all components in parallel */
  const fetchAllParallel = useCallback(async () => {
    const skillProfile = await getSkillProfileSafe();
    const components: FocusComponent[] = ['challenge', 'goal', 'learningTopics'];
    
    setLoadingComponents(components);
    setError(null);
    
    // Fire all requests in parallel
    const promises = components.map(async (component) => {
      const result = await fetchComponent(component, skillProfile);
      if (result) {
        await mergeAndSave(result, component);
      }
      return { component, result };
    });
    
    const results = await Promise.allSettled(promises);
    
    // Check if all failed
    const allFailed = results.every(
      r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.result)
    );
    
    if (allFailed) {
      setError('Failed to load focus content');
      // Try to load cached data
      const cached = await focusStore.getTodaysFocus();
      if (cached) setData(cached);
    }
    
    setIsNewDay(false);
  }, [fetchComponent, mergeAndSave]);

  /** Refetch a specific component or all */
  const refetch = useCallback(async (component?: FocusComponent) => {
    const skillProfile = await getSkillProfileSafe();
    
    if (component) {
      const result = await fetchComponent(component, skillProfile);
      if (result) {
        await mergeAndSave(result, component);
      }
    } else {
      await fetchAllParallel();
    }
  }, [fetchComponent, mergeAndSave, fetchAllParallel]);

  /** Skip a single topic and generate a replacement */
  const skipAndReplaceTopic = useCallback(async (
    skippedTopicId: string,
    existingTopicTitles: string[]
  ) => {
    // Track which topic is being skipped for revert on stop
    currentSkippingTopicIdRef.current = skippedTopicId;
    
    // Get skill profile before starting operation
    const skillProfile = await getSkillProfileSafe();
    
    // Use background job via backend - this survives navigation!
    // The server continues processing even if user navigates away or closes tab
    operationsManager.startBackgroundJob<{ learningTopic: LearningTopic }>({
      type: 'topic-regeneration',
      targetId: skippedTopicId,
      input: {
        existingTopicTitles,
        skillProfile: skillProfile?.skills.length ? skillProfile : undefined,
      },
      
      // onComplete handles persistence - runs when we poll and find job completed
      onComplete: async (result) => {
        if (!result?.learningTopic) {
          log.warn('Topic regeneration completed but no topic returned');
          return;
        }
        
        const dateKey = getDateKey();
        
        // Mark the original topic as skipped (keeps it in history)
        await focusStore.transitionTopic(dateKey, skippedTopicId, 'skipped', 'dashboard');
        
        // ADD the new topic (don't replace - keep full history log)
        await focusStore.addTopic(dateKey, result.learningTopic);
        log.debug(`New topic added: ${result.learningTopic.id}, skipped: ${skippedTopicId}`);
        
        // Update React state (best effort - may be no-op if unmounted)
        const currentFocus = await focusStore.getTodaysFocus();
        if (currentFocus) {
          setData(currentFocus);
        }
        
        currentSkippingTopicIdRef.current = null;
      },
      
      onError: (err) => {
        log.error('Failed to generate replacement topic:', err);
        currentSkippingTopicIdRef.current = null;
      },
    });
  }, []);

  // Initial fetch on mount
  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    
    (async () => {
      const cached = await focusStore.getTodaysFocus();
      const newDay = await focusStore.isNewDay();
      setIsNewDay(newDay);
      
      if (cached && !newDay) {
        setData(cached);
        setLoadingComponents([]);
      } else {
        await fetchAllParallel();
      }
    })();
  }, [fetchAllParallel]);

  const generatedAt = data?.meta.generatedAt ?? null;
  
  return { 
    data, 
    loadingComponents,
    error, 
    isAIEnabled: data?.meta.aiEnabled ?? false,
    toolsUsed: data?.meta.toolsUsed ?? [],
    refetch,
    skipAndReplaceTopic,
    skippingTopicIds,
    generatedAt,
    generatedAtFormatted: generatedAt ? formatTimestamp(generatedAt) : null,
    componentTimestamps: {
      challenge: null,
      goal: null,
      learningTopics: null,
    },
    isNewDay,
    stopComponent,
    stopTopicSkip,
    stopAll,
  };
}


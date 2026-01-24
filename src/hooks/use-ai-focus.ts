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
import type { FocusResponse } from '@/lib/focus/types';
import { logger } from '@/lib/logger';
import { formatTimestamp, now } from '@/lib/utils/date-utils';
import { getSkillProfile } from '@/lib/skills/storage';
import type { SkillProfile } from '@/lib/skills/types';
import { DEFAULT_SKILL_PROFILE } from '@/lib/skills/types';
import { useCallback, useEffect, useRef, useState } from 'react';

const log = logger.withTag('useAIFocus');

type FocusComponent = 'challenge' | 'goal' | 'learningTopics';

function getSkillProfileSafe(): SkillProfile {
  if (typeof window === 'undefined') return DEFAULT_SKILL_PROFILE;
  try {
    return getSkillProfile();
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
  generatedAt: string | null;
  generatedAtFormatted: string | null;
  componentTimestamps: Record<FocusComponent, string | null>;
  isNewDay: boolean;
}

export function useAIFocus(): UseAIFocusResult {
  const [data, setData] = useState<FocusResponse | null>(null);
  const [loadingComponents, setLoadingComponents] = useState<FocusComponent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isNewDay, setIsNewDay] = useState(false);
  const hasFetchedRef = useRef(false);

  /** Fetch a single component */
  const fetchComponent = useCallback(async (
    component: FocusComponent,
    skillProfile?: SkillProfile
  ): Promise<Partial<FocusResponse> | null> => {
    try {
      setLoadingComponents(prev => [...prev.filter(c => c !== component), component]);
      
      const result = await apiPost<Partial<FocusResponse>>('/api/focus', {
        component,
        skillProfile: skillProfile?.skills.length ? skillProfile : undefined,
      }, { timeout: 60000 });
      
      return result;
    } catch (err) {
      log.error(`Failed to fetch ${component}:`, err);
      return null;
    } finally {
      setLoadingComponents(prev => prev.filter(c => c !== component));
    }
  }, []);

  /** Merge a component result into current data and save */
  const mergeAndSave = useCallback(async (
    componentResult: Partial<FocusResponse>,
    component: FocusComponent
  ) => {
    setData(prev => {
      const merged: FocusResponse = {
        challenge: component === 'challenge' && componentResult.challenge 
          ? componentResult.challenge 
          : (prev?.challenge || { id: '', title: '', description: '', difficulty: 'intermediate', language: '', estimatedTime: '', whyThisChallenge: [] }),
        goal: component === 'goal' && componentResult.goal
          ? componentResult.goal
          : (prev?.goal || { id: '', title: '', description: '', progress: 0, target: '', reasoning: '' }),
        learningTopics: component === 'learningTopics' && componentResult.learningTopics
          ? componentResult.learningTopics
          : (prev?.learningTopics || []),
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
      
      // Save async (don't block render)
      focusStore.saveTodaysFocus(merged).catch(err => {
        log.error('Failed to save focus:', err);
      });
      
      return merged;
    });
  }, []);

  /** Fetch all components in parallel */
  const fetchAllParallel = useCallback(async () => {
    const skillProfile = getSkillProfileSafe();
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
    const skillProfile = getSkillProfileSafe();
    
    if (component) {
      const result = await fetchComponent(component, skillProfile);
      if (result) {
        await mergeAndSave(result, component);
      }
    } else {
      await fetchAllParallel();
    }
  }, [fetchComponent, mergeAndSave, fetchAllParallel]);

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
    generatedAt,
    generatedAtFormatted: generatedAt ? formatTimestamp(generatedAt) : null,
    componentTimestamps: {
      challenge: null,
      goal: null,
      learningTopics: null,
    },
    isNewDay,
  };
}


/**
 * Focus API Route
 * GET/POST /api/focus
 *
 * Uses Copilot SDK to generate personalized daily focus components.
 * Supports single-component requests for parallel loading:
 * - POST with component: 'challenge' | 'goal' | 'learningTopics'
 *
 * Uses minimal prompts for faster response times (~5-15s per component).
 */

import { parseJsonBodyWithFallback } from '@/lib/api';
import { now, nowMs } from '@/lib/utils/date-utils';
import { extractJSON } from '@/lib/utils/json-utils';
import {
    buildChallengePrompt,
    buildGoalPrompt,
    buildLearningTopicsPrompt,
} from '@/lib/copilot/prompts';
import {
    createLoggedLightweightCoachSession,
} from '@/lib/copilot/server';
import {
    addMissingIds,
    generateCalibrationSuggestions,
    getFallbackChallenge,
    getFallbackGoal,
    getFallbackLearningTopics,
} from '@/lib/focus/server-utils';
import type { FocusResponse } from '@/lib/focus/types';
import { buildCompactContext, serializeContext } from '@/lib/github/profile';
import type { CompactDeveloperProfile } from '@/lib/github/types';
import { logger } from '@/lib/logger';
import type { SkillProfile } from '@/lib/skills/types';
import { NextRequest, NextResponse } from 'next/server';

const log = logger.withTag('Focus API');

type FocusComponent = 'challenge' | 'goal' | 'learningTopics';

/**
 * Generate a single focus component with minimal prompt.
 */
async function generateSingleComponent(
  component: FocusComponent,
  serializedContext: string,
  skillProfile?: SkillProfile
): Promise<Partial<FocusResponse>> {
  // Select the appropriate prompt builder
  const promptBuilders = {
    challenge: buildChallengePrompt,
    goal: buildGoalPrompt,
    learningTopics: buildLearningTopicsPrompt,
  };
  
  const prompt = promptBuilders[component](serializedContext, skillProfile);
  
  const loggedSession = await createLoggedLightweightCoachSession(
    `Focus: ${component}`,
    prompt.slice(0, 50)
  );
  
  log.info(`[${component}] Sending prompt (${prompt.length} chars)...`);
  const result = await loggedSession.sendAndWait(prompt);
  loggedSession.destroy();
  
  log.info(`[${component}] Complete: ${result.totalTimeMs}ms`);
  
  const parsed = extractJSON<Partial<FocusResponse>>(result.responseText);
  if (!parsed) {
    throw new Error(`Failed to parse ${component} response`);
  }
  
  // Add IDs if missing
  const withIds = addMissingIds(parsed, [component]);
  withIds.meta = {
    generatedAt: now(),
    aiEnabled: true,
    model: loggedSession.model,
    toolsUsed: [],
    totalTimeMs: result.totalTimeMs,
    usedCachedProfile: true,
  };
  
  return withIds;
}

async function generateFocus(options: { 
  component?: FocusComponent;
  skillProfile?: SkillProfile;
} = {}): Promise<Partial<FocusResponse>> {
  const startTime = nowMs();
  const { component, skillProfile } = options;

  let serializedContext = '';
  let compactProfile: CompactDeveloperProfile | null = null;

  try {
    // Build compact profile context
    try {
      compactProfile = await buildCompactContext(1000);
      serializedContext = serializeContext(compactProfile);
      log.info(`Context: ${serializedContext.length} chars`);
    } catch (profileError) {
      log.warn('Failed to build context:', profileError);
    }

    // Single component request - fast path
    if (component) {
      const result = await generateSingleComponent(component, serializedContext, skillProfile);
      
      // Add calibration suggestions for challenge requests
      if (component === 'challenge' && compactProfile) {
        result.calibrationNeeded = generateCalibrationSuggestions(compactProfile, skillProfile);
      }
      
      return result;
    }

    // Full request - generate all components in parallel
    log.info('Generating all components in parallel...');
    const [challengeResult, goalResult, topicsResult] = await Promise.allSettled([
      generateSingleComponent('challenge', serializedContext, skillProfile),
      generateSingleComponent('goal', serializedContext, skillProfile),
      generateSingleComponent('learningTopics', serializedContext, skillProfile),
    ]);

    const totalTime = nowMs() - startTime;
    
    // Merge results, using fallbacks for failures
    const focusResult: Partial<FocusResponse> = {
      challenge: challengeResult.status === 'fulfilled' 
        ? challengeResult.value.challenge 
        : getFallbackChallenge(),
      goal: goalResult.status === 'fulfilled'
        ? goalResult.value.goal
        : getFallbackGoal(),
      learningTopics: topicsResult.status === 'fulfilled'
        ? topicsResult.value.learningTopics
        : getFallbackLearningTopics(),
      meta: {
        generatedAt: now(),
        aiEnabled: true,
        model: 'gpt-5-mini',
        toolsUsed: [],
        totalTimeMs: totalTime,
        usedCachedProfile: serializedContext.length > 0,
      },
    };

    if (compactProfile) {
      focusResult.calibrationNeeded = generateCalibrationSuggestions(compactProfile, skillProfile);
    }

    return focusResult;
  } catch (error) {
    const totalTime = nowMs() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error(`Error after ${totalTime}ms:`, errorMessage);

    // Return component-specific fallback or full fallback
    if (component === 'challenge') {
      return { challenge: getFallbackChallenge(), meta: { generatedAt: now(), aiEnabled: false, model: 'fallback', toolsUsed: [], totalTimeMs: totalTime, usedCachedProfile: false } };
    }
    if (component === 'goal') {
      return { goal: getFallbackGoal(), meta: { generatedAt: now(), aiEnabled: false, model: 'fallback', toolsUsed: [], totalTimeMs: totalTime, usedCachedProfile: false } };
    }
    if (component === 'learningTopics') {
      return { learningTopics: getFallbackLearningTopics(), meta: { generatedAt: now(), aiEnabled: false, model: 'fallback', toolsUsed: [], totalTimeMs: totalTime, usedCachedProfile: false } };
    }
    
    return {
      challenge: getFallbackChallenge(),
      goal: getFallbackGoal(),
      learningTopics: getFallbackLearningTopics(),
      meta: { generatedAt: now(), aiEnabled: false, model: 'fallback', toolsUsed: [], totalTimeMs: totalTime, usedCachedProfile: false },
    };
  }
}


export async function GET() {
  const result = await generateFocus();
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const body = await parseJsonBodyWithFallback<{ 
    component?: FocusComponent;
    skillProfile?: SkillProfile;
  }>(request, {});
  
  const result = await generateFocus({ 
    component: body.component,
    skillProfile: body.skillProfile,
  });
  return NextResponse.json(result);
}

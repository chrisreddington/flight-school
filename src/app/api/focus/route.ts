/**
 * Focus API Route
 * GET/POST /api/focus
 *
 * Uses Copilot SDK to generate personalized daily focus components.
 * Supports single-component requests for parallel loading:
 * - POST with component: 'challenge' | 'goal' | 'learningTopics' | 'singleTopic'
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
    buildSingleTopicPrompt,
} from '@/lib/copilot/prompts';
import {
    createSessionIdentity,
    createLoggedLightweightCoachSession,
    type SessionIdentity,
} from '@/lib/copilot/server';
import {
    addMissingIds,
    generateCalibrationSuggestions,
    getFallbackChallenge,
    getFallbackGoal,
    getFallbackLearningTopics,
} from '@/lib/focus/server-utils';
import type { FocusResponse, LearningTopic } from '@/lib/focus/types';
import type { InterleavingHint } from '@/lib/focus/interleaving';
import { getOctokitForRequest } from '@/lib/github/client';
import { buildCompactContext, serializeContext } from '@/lib/github/profile';
import type { CompactDeveloperProfile } from '@/lib/github/types';
import { isCopilotEntitlementError } from '@/lib/copilot/entitlement';
import { logger } from '@/lib/logger';
import { withUserGuards } from '@/lib/security/guard';
import { guardErrorResponse } from '@/lib/security/http';
import { FOCUS_GUARD } from '@/lib/security/route-defaults';
import type { SkillProfile } from '@/lib/skills/types';
import { NextRequest, NextResponse } from 'next/server';

const log = logger.withTag('Focus API');

type FocusComponent = 'challenge' | 'goal' | 'learningTopics' | 'singleTopic';

/**
 * Generate a single focus component with minimal prompt.
 */
async function generateSingleComponent(
  identity: SessionIdentity,
  component: Exclude<FocusComponent, 'singleTopic'>,
  serializedContext: string,
  skillProfile?: SkillProfile,
  options: {
    reviewTopics?: string[];
    interleavingHint?: InterleavingHint;
    debugMode?: boolean;
  } = {}
): Promise<Partial<FocusResponse>> {
  const { reviewTopics, interleavingHint, debugMode } = options;

  // Select the appropriate prompt builder
  const buildPrompt = () => {
    if (component === 'learningTopics') {
      return buildLearningTopicsPrompt(serializedContext, skillProfile, reviewTopics);
    }
    if (component === 'challenge') {
      return buildChallengePrompt(serializedContext, skillProfile, interleavingHint, { forceDebug: debugMode });
    }
    return buildGoalPrompt(serializedContext, skillProfile);
  };
  
  // Debug: log skill profile info
  if (skillProfile) {
    log.info(`[${component}] SkillProfile: ${skillProfile.skills.length} skills`);
    log.info(`[${component}] Skills: ${skillProfile.skills.map(s => `${s.skillId}:${s.level}${s.notInterested ? '(excluded)' : ''}`).join(', ')}`);
  } else {
    log.info(`[${component}] No skill profile provided`);
  }
  
  const prompt = buildPrompt();
  
  const loggedSession = await createLoggedLightweightCoachSession(
    identity,
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

/**
 * Generate a single replacement topic (when user skips one).
 */
async function generateSingleTopic(
  identity: SessionIdentity,
  serializedContext: string,
  existingTopicTitles: string[],
  skillProfile?: SkillProfile
): Promise<{ learningTopic: LearningTopic }> {
  const prompt = buildSingleTopicPrompt(serializedContext, existingTopicTitles, skillProfile);
  
  const loggedSession = await createLoggedLightweightCoachSession(
    identity,
    'Focus: singleTopic',
    prompt.slice(0, 50)
  );
  
  log.info(`[singleTopic] Sending prompt (${prompt.length} chars), excluding: ${existingTopicTitles.join(', ')}`);
  const result = await loggedSession.sendAndWait(prompt);
  loggedSession.destroy();
  
  log.info(`[singleTopic] Complete: ${result.totalTimeMs}ms`);
  
  const parsed = extractJSON<{ learningTopic: LearningTopic }>(result.responseText);
  if (!parsed?.learningTopic) {
    throw new Error('Failed to parse single topic response');
  }
  
  // Add ID if missing
  if (!parsed.learningTopic.id) {
    parsed.learningTopic.id = crypto.randomUUID();
  }
  
  return parsed;
}

async function generateFocus(identity: SessionIdentity, options: { 
  component?: FocusComponent;
  skillProfile?: SkillProfile;
  existingTopicTitles?: string[];
  reviewTopics?: string[];
  interleavingHint?: InterleavingHint;
  debugMode?: boolean;
} = {}): Promise<Partial<FocusResponse> | { learningTopic: LearningTopic }> {
  const startTime = nowMs();
  const { component, skillProfile, existingTopicTitles, reviewTopics, interleavingHint, debugMode } = options;

  let serializedContext = '';
  let compactProfile: CompactDeveloperProfile | null = null;

  try {
    // Build compact profile context
    try {
      const octokit = await getOctokitForRequest();
      compactProfile = await buildCompactContext(octokit, 1000);
      serializedContext = serializeContext(compactProfile);
      log.info(`Context: ${serializedContext.length} chars`);
    } catch (profileError) {
      log.warn('Failed to build context:', profileError);
    }

    // Single topic replacement request
    if (component === 'singleTopic') {
      return await generateSingleTopic(identity, serializedContext, existingTopicTitles || [], skillProfile);
    }

    // Single component request - fast path
    if (component) {
      const result = await generateSingleComponent(identity, component, serializedContext, skillProfile, {
        reviewTopics,
        interleavingHint,
        debugMode: component === 'challenge' ? debugMode : undefined,
      });
      
      // Add calibration suggestions for challenge requests
      if (component === 'challenge' && compactProfile) {
        result.calibrationNeeded = generateCalibrationSuggestions(compactProfile, skillProfile);
      }
      
      return result;
    }

    // Full request - generate all components in parallel
    log.info('Generating all components in parallel...');
    const [challengeResult, goalResult, topicsResult] = await Promise.allSettled([
      generateSingleComponent(identity, 'challenge', serializedContext, skillProfile, { interleavingHint }),
      generateSingleComponent(identity, 'goal', serializedContext, skillProfile),
      generateSingleComponent(identity, 'learningTopics', serializedContext, skillProfile, { reviewTopics }),
    ]);

    // D2: If any sub-generation failed due to missing Copilot entitlement,
    // surface that as 402 instead of silently swapping in static fallback.
    for (const settled of [challengeResult, goalResult, topicsResult]) {
      if (settled.status === 'rejected' && isCopilotEntitlementError(settled.reason)) {
        throw settled.reason;
      }
    }

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
    // D2: Re-throw entitlement errors so the route maps them to 402.
    // Static fallback is for "deployment has no AI", not "this user lacks
    // a Copilot license".
    if (isCopilotEntitlementError(error)) {
      throw error;
    }

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
  try {
    const result = await withUserGuards(
      { ...FOCUS_GUARD, eventType: 'copilot.session.create', auditMetadata: { route: '/api/focus', method: 'GET' } },
      (ctx) => generateFocus(createSessionIdentity(ctx)),
    );
    return NextResponse.json(result);
  } catch (error) {
    const guardResponse = guardErrorResponse(error);
    if (guardResponse) return guardResponse;
    throw error;
  }
}

export async function POST(request: NextRequest) {
  const body = await parseJsonBodyWithFallback<{
    component?: FocusComponent;
    skillProfile?: SkillProfile;
    existingTopicTitles?: string[];
    reviewTopics?: string[];
    interleavingHint?: InterleavingHint;
    debugMode?: boolean;
  }>(request, {});

  try {
    const result = await withUserGuards(
      { ...FOCUS_GUARD, eventType: 'copilot.session.create', auditMetadata: { route: '/api/focus', method: 'POST', component: body.component } },
      (ctx) => generateFocus(createSessionIdentity(ctx), {
        component: body.component,
        skillProfile: body.skillProfile,
        existingTopicTitles: body.existingTopicTitles,
        reviewTopics: body.reviewTopics,
        interleavingHint: body.interleavingHint,
        debugMode: body.debugMode,
      }),
    );
    return NextResponse.json(result);
  } catch (error) {
    const guardResponse = guardErrorResponse(error);
    if (guardResponse) return guardResponse;
    throw error;
  }
}

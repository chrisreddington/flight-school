/**
 * Focus generation handlers — the heavy lifting behind `/api/focus`.
 *
 * Lives outside the route module so the route can stay thin (guards +
 * request parsing + `NextResponse.json`). Every export is server-only.
 */

import 'server-only';

import { now, nowMs } from '@/lib/utils/date-utils';
import { extractJSON } from '@/lib/utils/json-utils';
import {
  buildChallengePrompt,
  buildGoalPrompt,
  buildLearningTopicsPrompt,
  buildSingleTopicPrompt,
} from '@/lib/copilot/prompts';
import { type SessionIdentity } from '@/lib/copilot/session-identity';
import { executeCopilotCoachJob } from '@/lib/copilot/execution';
import { isCopilotEntitlementError } from '@/lib/copilot/entitlement';
import {
  addMissingIds,
  generateCalibrationSuggestions,
  getFallbackChallenge,
  getFallbackGoal,
  getFallbackLearningTopics,
} from '@/lib/focus/server-utils';
import { diversifyLearningTopics } from '@/lib/focus/diversify-topics';
import type { FocusResponse, LearningTopic } from '@/lib/focus/types';
import type { InterleavingHint } from '@/lib/focus/interleaving';
import { buildProfileContext } from '@/lib/github/profile-context';
import type { CompactDeveloperProfile } from '@/lib/github/types';
import { logger } from '@/lib/logger';
import type { SkillProfile } from '@/lib/skills/types';

const log = logger.withTag('Focus API');

export type FocusComponent = 'challenge' | 'goal' | 'learningTopics' | 'singleTopic';

export interface FocusOptions {
  component?: FocusComponent;
  skillProfile?: SkillProfile;
  existingTopicTitles?: string[];
  existingChallengeTitles?: string[];
  reviewTopics?: string[];
  interleavingHint?: InterleavingHint;
  debugMode?: boolean;
}

function createFallbackMeta(totalTimeMs: number) {
  return {
    generatedAt: now(),
    aiEnabled: false,
    model: 'fallback',
    toolsUsed: [],
    // Server-side floor only (handler/SDK time), not client-perceived E2E latency.
    totalTimeMs,
    usedCachedProfile: false,
    skillProfileLastUpdated: undefined,
  };
}

function createFallbackFocusResult(component: FocusComponent | undefined, totalTimeMs: number) {
  const meta = createFallbackMeta(totalTimeMs);
  if (component === 'challenge') return { challenge: getFallbackChallenge(), meta };
  if (component === 'goal') return { goal: getFallbackGoal(), meta };
  if (component === 'learningTopics') return { learningTopics: getFallbackLearningTopics(), meta };
  return {
    challenge: getFallbackChallenge(),
    goal: getFallbackGoal(),
    learningTopics: getFallbackLearningTopics(),
    meta,
  };
}

async function generateSingleComponent(
  identity: SessionIdentity,
  component: Exclude<FocusComponent, 'singleTopic'>,
  serializedContext: string,
  skillProfile?: SkillProfile,
  options: {
    reviewTopics?: string[];
    existingChallengeTitles?: string[];
    interleavingHint?: InterleavingHint;
    debugMode?: boolean;
  } = {},
): Promise<Partial<FocusResponse>> {
  const { reviewTopics, existingChallengeTitles, interleavingHint, debugMode } = options;

  const buildPrompt = () => {
    if (component === 'learningTopics') {
      return buildLearningTopicsPrompt(serializedContext, skillProfile, reviewTopics);
    }
    if (component === 'challenge') {
      return buildChallengePrompt(
        serializedContext,
        skillProfile,
        interleavingHint,
        {
          forceDebug: debugMode,
        },
        existingChallengeTitles,
      );
    }
    return buildGoalPrompt(serializedContext, skillProfile);
  };

  if (skillProfile) {
    log.info(`[${component}] SkillProfile: ${skillProfile.skills.length} skills`);
    log.info(
      `[${component}] Skills: ${skillProfile.skills.map((s) => `${s.skillId}:${s.level}${s.notInterested ? '(excluded)' : ''}`).join(', ')}`,
    );
  } else {
    log.info(`[${component}] No skill profile provided`);
  }

  const prompt = buildPrompt();

  log.info(`[${component}] Sending prompt (${prompt.length} chars)...`);
  const result = await executeCopilotCoachJob({
    identity,
    variant: 'lightweight',
    operationName: `Focus: ${component}`,
    prompt,
    inputSummary: prompt.slice(0, 50),
  });

  log.info(`[${component}] Complete: ${result.meta.totalTimeMs}ms`);

  const parsed = extractJSON<Partial<FocusResponse>>(result.response);
  if (!parsed) {
    throw new Error(`Failed to parse ${component} response`);
  }

  const withIds = addMissingIds(parsed, [component]);

  // M3.2: when the LLM produced learningTopics (we ask for N=5), keep
  // at most 1 `current-repo` and return at most 3 to the UI.
  if (component === 'learningTopics' && withIds.learningTopics?.length) {
    const before = withIds.learningTopics.length;
    withIds.learningTopics = diversifyLearningTopics(withIds.learningTopics);
    log.info(`[learningTopics] Diversified ${before} → ${withIds.learningTopics.length}`);
  }

  withIds.meta = {
    generatedAt: now(),
    aiEnabled: true,
    model: result.meta.model,
    toolsUsed: [],
    // Server-side floor only (handler/SDK time), not client-perceived E2E latency.
    totalTimeMs: result.meta.totalTimeMs,
    usedCachedProfile: true,
    skillProfileLastUpdated: skillProfile?.lastUpdated,
  };

  return withIds;
}

async function generateSingleTopic(
  identity: SessionIdentity,
  serializedContext: string,
  existingTopicTitles: string[],
  skillProfile?: SkillProfile,
): Promise<{ learningTopic: LearningTopic }> {
  const prompt = buildSingleTopicPrompt(serializedContext, existingTopicTitles, skillProfile);

  log.info(`[singleTopic] Sending prompt (${prompt.length} chars), excluding: ${existingTopicTitles.join(', ')}`);
  const result = await executeCopilotCoachJob({
    identity,
    variant: 'lightweight',
    operationName: 'Focus: singleTopic',
    prompt,
    inputSummary: prompt.slice(0, 50),
  });

  log.info(`[singleTopic] Complete: ${result.meta.totalTimeMs}ms`);

  const parsed = extractJSON<{ learningTopic: LearningTopic }>(result.response);
  if (!parsed?.learningTopic) {
    throw new Error('Failed to parse single topic response');
  }

  if (!parsed.learningTopic.id) {
    parsed.learningTopic.id = crypto.randomUUID();
  }

  return parsed;
}

/**
 * Produce a focus response (or a single replacement topic) for the
 * authenticated user. Handles its own profile-context build, fan-out
 * over the three sub-components, entitlement re-throw, and the
 * static-fallback shape.
 */
export async function generateFocus(
  identity: SessionIdentity,
  options: FocusOptions = {},
): Promise<Partial<FocusResponse> | { learningTopic: LearningTopic }> {
  const startTime = nowMs();
  const {
    component,
    skillProfile,
    existingTopicTitles,
    existingChallengeTitles,
    reviewTopics,
    interleavingHint,
    debugMode,
  } = options;

  let serializedContext = '';
  let compactProfile: CompactDeveloperProfile | null = null;

  try {
    const built = await buildProfileContext({
      maxChars: 1000,
      logger: log,
      context: 'focus',
    });
    serializedContext = built.context;
    compactProfile = built.profile;
    if (serializedContext) log.info(`Context: ${serializedContext.length} chars`);

    if (component === 'singleTopic') {
      return await generateSingleTopic(identity, serializedContext, existingTopicTitles || [], skillProfile);
    }

    if (component) {
      const result = await generateSingleComponent(identity, component, serializedContext, skillProfile, {
        reviewTopics,
        existingChallengeTitles,
        interleavingHint,
        debugMode: component === 'challenge' ? debugMode : undefined,
      });

      if (component === 'challenge' && compactProfile) {
        result.calibrationNeeded = generateCalibrationSuggestions(compactProfile, skillProfile);
      }

      return result;
    }

    log.info('Generating all components in parallel...');
    const [challengeResult, goalResult, topicsResult] = await Promise.allSettled([
      generateSingleComponent(identity, 'challenge', serializedContext, skillProfile, {
        interleavingHint,
      }),
      generateSingleComponent(identity, 'goal', serializedContext, skillProfile),
      generateSingleComponent(identity, 'learningTopics', serializedContext, skillProfile, {
        reviewTopics,
      }),
    ]);

    // D2: If any sub-generation failed due to missing Copilot entitlement,
    // surface that as 402 instead of silently swapping in static fallback.
    for (const settled of [challengeResult, goalResult, topicsResult]) {
      if (settled.status === 'rejected' && isCopilotEntitlementError(settled.reason)) {
        throw settled.reason;
      }
    }

    const totalTime = nowMs() - startTime;

    const focusResult: Partial<FocusResponse> = {
      challenge: challengeResult.status === 'fulfilled' ? challengeResult.value.challenge : getFallbackChallenge(),
      goal: goalResult.status === 'fulfilled' ? goalResult.value.goal : getFallbackGoal(),
      learningTopics:
        topicsResult.status === 'fulfilled' ? topicsResult.value.learningTopics : getFallbackLearningTopics(),
      meta: {
        generatedAt: now(),
        aiEnabled: true,
        model: 'gpt-5-mini',
        toolsUsed: [],
        // Server-side floor only (handler/SDK time), not client-perceived E2E latency.
        totalTimeMs: totalTime,
        usedCachedProfile: serializedContext.length > 0,
        skillProfileLastUpdated: skillProfile?.lastUpdated,
      },
    };

    if (compactProfile) {
      focusResult.calibrationNeeded = generateCalibrationSuggestions(compactProfile, skillProfile);
    }

    return focusResult;
  } catch (error) {
    // D2: Re-throw entitlement errors so the route maps them to 402.
    // Static fallback is for "deployment has no AI", not "this user
    // lacks a Copilot license".
    if (isCopilotEntitlementError(error)) {
      throw error;
    }

    const totalTime = nowMs() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error(`Error after ${totalTime}ms:`, errorMessage);

    return createFallbackFocusResult(component, totalTime);
  }
}

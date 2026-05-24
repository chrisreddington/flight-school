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
import {
  createLoggedLightweightCoachSession,
  type SessionIdentity,
} from '@/lib/copilot/server';
import { isCopilotEntitlementError } from '@/lib/copilot/entitlement';
import {
  addMissingIds,
  generateCalibrationSuggestions,
  getFallbackChallenge,
  getFallbackGoal,
  getFallbackLearningTopics,
} from '@/lib/focus/server-utils';
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
    totalTimeMs,
    usedCachedProfile: false,
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
    interleavingHint?: InterleavingHint;
    debugMode?: boolean;
  } = {}
): Promise<Partial<FocusResponse>> {
  const { reviewTopics, interleavingHint, debugMode } = options;

  const buildPrompt = () => {
    if (component === 'learningTopics') {
      return buildLearningTopicsPrompt(serializedContext, skillProfile, reviewTopics);
    }
    if (component === 'challenge') {
      return buildChallengePrompt(serializedContext, skillProfile, interleavingHint, { forceDebug: debugMode });
    }
    return buildGoalPrompt(serializedContext, skillProfile);
  };

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
  const { component, skillProfile, existingTopicTitles, reviewTopics, interleavingHint, debugMode } = options;

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

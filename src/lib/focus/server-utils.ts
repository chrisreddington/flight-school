/**
 * Focus server utilities.
 *
 * Server-only helpers for constructing prompts and normalizing focus payloads.
 */

import type { CalibrationNeededItem, Challenge, DailyGoal, FocusResponse, LearningTopic } from '@/lib/focus/types';
import { nowMs } from '@/lib/utils/date-utils';
import type { CompactDeveloperProfile } from '@/lib/github/types';
import type { SkillProfile } from '@/lib/skills/types';

/**
 * Normalize a partial focus response with IDs and defaults.
 */
export function addMissingIds(
  data: Partial<FocusResponse>,
  requestedComponents?: string[]
): Partial<FocusResponse> {
  const timestamp = nowMs();
  const components = requestedComponents || ['challenge', 'goal', 'learningTopics'];
  const result: Partial<FocusResponse> = {};

  if (components.includes('challenge') && data.challenge) {
    result.challenge = {
      id: data.challenge.id || `challenge-${timestamp}`,
      title: data.challenge.title || 'Build Something New',
      description: data.challenge.description || 'Practice your skills with a focused coding challenge.',
      difficulty: data.challenge.difficulty || 'intermediate',
      language: data.challenge.language || 'TypeScript',
      estimatedTime: data.challenge.estimatedTime || '30 min',
      whyThisChallenge: data.challenge.whyThisChallenge || ['Based on your recent activity'],
    };
  }

  if (components.includes('goal') && data.goal) {
    result.goal = {
      id: data.goal.id || `goal-${timestamp}`,
      title: data.goal.title || 'Stay Active',
      description: data.goal.description || 'Keep your coding streak going.',
      progress: data.goal.progress || 0,
      target: data.goal.target || 'Daily contribution',
      reasoning: data.goal.reasoning || 'Consistency builds expertise.',
    };
  }

  if (components.includes('learningTopics') && data.learningTopics) {
    result.learningTopics = data.learningTopics.map((topic, idx) => ({
      id: topic.id || `topic-${timestamp}-${idx}`,
      title: topic.title || 'Learn Something New',
      description: topic.description || 'Expand your knowledge.',
      type: topic.type || 'concept',
      relatedTo: topic.relatedTo || 'Your projects',
    }));
  }

  return result;
}

/** Get fallback challenge */
export function getFallbackChallenge(): Challenge {
  return {
    id: 'fallback-challenge',
    title: 'Build a Type-Safe API Client',
    description: 'Create a generic HTTP client with full TypeScript type inference.',
    difficulty: 'intermediate',
    language: 'TypeScript',
    estimatedTime: '30 min',
    whyThisChallenge: ['Core skill for modern development'],
  };
}

/** Get fallback goal */
export function getFallbackGoal(): DailyGoal {
  return {
    id: 'fallback-goal',
    title: 'Make a Contribution Today',
    description: "Push code, open a PR, or review someone's work.",
    progress: 0,
    target: '1 contribution',
    reasoning: 'Daily activity builds momentum.',
  };
}

/** Get fallback learning topics */
export function getFallbackLearningTopics(): LearningTopic[] {
  return [
    {
      id: 'fallback-topic-1',
      title: 'Advanced TypeScript Patterns',
      description: 'Master conditional types and mapped types.',
      type: 'concept',
      relatedTo: 'TypeScript projects',
    },
  ];
}


/**
 * Generate calibration suggestions based on language usage.
 */
export function generateCalibrationSuggestions(
  compactProfile: CompactDeveloperProfile,
  skillProfile?: SkillProfile
): CalibrationNeededItem[] {
  const suggestions: CalibrationNeededItem[] = [];
  const existingSkillIds = new Set(
    skillProfile?.skills.map((s) => s.skillId.toLowerCase()) ?? []
  );

  const languages = compactProfile.lp || [];

  for (const lang of languages) {
    const skillId = lang.n.toLowerCase().replace(/\s+/g, '-');

    if (existingSkillIds.has(skillId)) {
      continue;
    }

    if (lang.p < 5) {
      continue;
    }

    let suggestedLevel: 'beginner' | 'intermediate' | 'advanced';
    if (lang.p >= 50) {
      suggestedLevel = 'advanced';
    } else if (lang.p >= 20) {
      suggestedLevel = 'intermediate';
    } else {
      suggestedLevel = 'beginner';
    }

    suggestions.push({
      skillId,
      displayName: lang.n,
      suggestedLevel,
    });

    if (suggestions.length >= 2) {
      break;
    }
  }

  return suggestions;
}

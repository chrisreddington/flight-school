/**
 * Job Executors
 * 
 * Contains the actual logic for executing different job types.
 * Each executor is responsible for running the AI operation and
 * returning the result.
 */

import type { DailyChallenge, DailyGoal, LearningTopic } from '@/lib/focus/types';
import type { SkillProfile } from '@/lib/skills/types';

export type JobType = 'topic-regeneration' | 'challenge-regeneration' | 'goal-regeneration' | 'focus-generation' | 'challenge-generation';

export interface TopicRegenerationInput {
  existingTopicTitles: string[];
  skillProfile?: SkillProfile;
  /** Position for in-place replacement */
  position?: number | null;
}

export interface TopicRegenerationResult {
  learningTopic: LearningTopic;
}

export interface ChallengeRegenerationInput {
  existingChallengeTitles: string[];
  skillProfile?: SkillProfile;
}

export interface ChallengeRegenerationResult {
  challenge: DailyChallenge;
}

export interface GoalRegenerationInput {
  existingGoalTitles: string[];
  skillProfile?: SkillProfile;
}

export interface GoalRegenerationResult {
  goal: DailyGoal;
}

// Note: The actual execution happens in the API route that processes jobs.
// This file just defines types for type safety.

export type JobInput = TopicRegenerationInput | ChallengeRegenerationInput | GoalRegenerationInput;
export type JobResult = TopicRegenerationResult | ChallengeRegenerationResult | GoalRegenerationResult;

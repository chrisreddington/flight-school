/**
 * Job Executors
 * 
 * Contains the actual logic for executing different job types.
 * Each executor is responsible for running the AI operation and
 * returning the result.
 */

import type { DailyChallenge, DailyGoal, LearningTopic } from '@/lib/focus/types';
import type { SkillProfile } from '@/lib/skills/types';
import type { RepoReference } from '@/lib/threads';

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

/** Input for chat response background job */
export interface ChatResponseInput {
  threadId: string;
  prompt: string;
  repos?: RepoReference[];
  learningMode?: boolean;
  useGitHubTools?: boolean;
}

/** Result from chat response background job */
export interface ChatResponseResult {
  threadId: string;
  content: string;
  hasActionableItem?: boolean;
  toolCalls?: string[];
  activeStreamId?: string;
}

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

/** Input for challenge evaluation background job */
export interface ChallengeEvaluationInput {
  challengeId: string;
  challenge: {
    title: string;
    description: string;
    language: string;
    difficulty: string;
    testCases?: string;
  };
  files: Array<{ name: string; content: string }>;
}

/** Result from challenge evaluation background job */
export interface ChallengeEvaluationResult {
  challengeId: string;
  isCorrect: boolean;
  feedback: string;
  strengths: string[];
  improvements: string[];
  score?: number;
  nextSteps?: string[];
  /** Streaming feedback content (updated incrementally) */
  streamingFeedback?: string;
  /** Partial metadata available before full result */
  partial?: {
    isCorrect: boolean;
    score?: number;
    strengths: string[];
    improvements: string[];
    nextSteps?: string[];
  };
}

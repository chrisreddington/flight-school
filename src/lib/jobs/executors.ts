/**
 * Job Executors
 * 
 * Contains the actual logic for executing different job types.
 * Each executor is responsible for running the AI operation and
 * returning the result.
 */

import type { DailyChallenge, DailyGoal, LearningTopic } from '@/lib/focus/types';
import type { SkillProfile } from '@/lib/skills/types';

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
  /**
   * Stable client-generated v4 uuid identifying the assistant message
   * this job will produce. Sent by the client up-front so:
   *   - Streaming deltas can be reconciled by id, not by prompt-match.
   *   - Duplicate-prompt resends don't overwrite earlier replies.
   *   - `(threadId, assistantMessageId)` acts as a per-user idempotency
   *     key for `/api/jobs` POST.
   *
   * Validated by the server as RFC4122 v4 shape. The server falls back
   * to `generateMessageId()` only for backwards compatibility with
   * older clients that haven't started sending the field yet.
   */
  assistantMessageId?: string;
  /** Repository full names (e.g., 'owner/repo') to focus MCP tools on */
  repos?: string[];
  /** Chat profile that drives model, prompt, and MCP capabilities. */
  profile: import('@/lib/copilot/profile-types').ChatResponseProfileId;
  /**
   * Caller-supplied capability selection. Omitted = use the profile's
   * `defaultCapabilities` on the worker side. The worker validates the
   * selection against the profile's `allowedCapabilities`.
   */
  capabilities?: import('@/lib/copilot/profile-types').CapabilitiesArg;
}

/** Result from chat response background job */
export interface ChatResponseResult {
  threadId: string;
  content: string;
  hasActionableItem?: boolean;
  toolCalls?: string[];
}

/** Input for challenge evaluation background job */
export interface ChallengeEvaluationInput {
  challengeId: string;
  challenge: {
    title: string;
    description: string;
    type?: 'implement' | 'debug';
    brokenCode?: string;
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

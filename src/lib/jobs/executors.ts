/**
 * Job Executors
 * 
 * Contains the actual logic for executing different job types.
 * Each executor is responsible for running the AI operation and
 * returning the result.
 */

import type { LearningTopic } from '@/lib/focus/types';
import type { SkillProfile } from '@/lib/skills/types';

export type JobType = 'topic-regeneration' | 'focus-generation' | 'challenge-generation';

export interface TopicRegenerationInput {
  existingTopicTitles: string[];
  skillProfile?: SkillProfile;
}

export interface TopicRegenerationResult {
  learningTopic: LearningTopic;
}

// Note: The actual execution happens in the API route that processes jobs.
// This file just defines types for type safety.

export type JobInput = TopicRegenerationInput;
export type JobResult = TopicRegenerationResult;

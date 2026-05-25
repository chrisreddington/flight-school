/**
 * Worker-owned background job executor dispatcher.
 */

import type {
  ChallengeEvaluationInput,
  ChallengeRegenerationInput,
  ChatResponseInput,
  GoalRegenerationInput,
  TopicRegenerationInput,
} from '@/lib/jobs';
import type { DispatchJobExecutionRequest } from '@/lib/jobs/dispatch';

import { executeChatResponse } from './executors/chat';
import { executeChallengeEvaluation } from './executors/evaluation';
import {
  executeChallengeRegeneration,
  executeGoalRegeneration,
  executeTopicRegeneration,
} from './executors/regeneration';

export async function executeWorkerJob({ jobId, type, input, userId }: DispatchJobExecutionRequest): Promise<void> {
  if (type === 'topic-regeneration') {
    return executeTopicRegeneration(jobId, input as TopicRegenerationInput, userId);
  }
  if (type === 'challenge-regeneration') {
    return executeChallengeRegeneration(jobId, input as ChallengeRegenerationInput, userId);
  }
  if (type === 'goal-regeneration') {
    return executeGoalRegeneration(jobId, input as GoalRegenerationInput, userId);
  }
  if (type === 'chat-response') {
    return executeChatResponse(jobId, input as ChatResponseInput, userId);
  }
  return executeChallengeEvaluation(jobId, input as ChallengeEvaluationInput, userId);
}

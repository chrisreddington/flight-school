import type {
  ChallengeEvaluationInput,
  ChallengeRegenerationInput,
  ChatResponseInput,
  GoalRegenerationInput,
  TopicRegenerationInput,
} from '@/lib/jobs';
import { logger } from '@/lib/logger';
import {
  executeChallengeEvaluation,
  executeChallengeRegeneration,
  executeChatResponse,
  executeGoalRegeneration,
  executeTopicRegeneration,
} from './job-executors';

const log = logger.withTag('Job Dispatcher');

export type DispatchableJobType =
  | 'topic-regeneration'
  | 'challenge-regeneration'
  | 'goal-regeneration'
  | 'chat-response'
  | 'challenge-evaluation';

export type DispatchableJobInput =
  | TopicRegenerationInput
  | ChallengeRegenerationInput
  | GoalRegenerationInput
  | ChatResponseInput
  | ChallengeEvaluationInput;

export interface DispatchJobExecutionRequest {
  jobId: string;
  type: DispatchableJobType;
  input: DispatchableJobInput;
  userId: string;
}

export async function executeDispatchedJob({
  jobId,
  type,
  input,
  userId,
}: DispatchJobExecutionRequest): Promise<void> {
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

/**
 * Schedule job execution using the current in-process dispatcher.
 *
 * The returned promise resolves after the scheduled executor finishes. Executor
 * failures are logged and swallowed to preserve the existing fire-and-forget
 * route behavior.
 */
export function dispatchJobExecution(request: DispatchJobExecutionRequest): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(() => {
      executeDispatchedJob(request)
        .catch((err: unknown) => {
          log.error(`Unhandled error in job ${request.jobId}:`, err);
        })
        .finally(resolve);
    });
  });
}

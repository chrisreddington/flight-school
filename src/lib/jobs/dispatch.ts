import type {
  ChallengeEvaluationInput,
  ChallengeRegenerationInput,
  ChatResponseInput,
  GoalRegenerationInput,
  TopicRegenerationInput,
} from '@/lib/jobs';
import type { TracePropagationHeaders } from '@/lib/observability/context-propagation';

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

export interface WorkerDispatchCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface DispatchJobExecutionToWorkerRequest extends DispatchJobExecutionRequest {
  credentials?: WorkerDispatchCredentials;
  traceContext?: TracePropagationHeaders;
}

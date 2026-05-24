import type { EvaluationResult, PartialEvaluationResult } from '@/lib/copilot/types';

/**
 * Structured failure classifications surfaced from the jobs API so the UI can
 * route credentials-expired errors to a re-auth CTA instead of a generic
 * error banner.
 */
export type EvaluationErrorCode =
  | 'credentials_missing'
  | 'credentials_refresh_failed'
  | 'unknown';

export interface EvaluationState {
  isLoading: boolean;
  partialResult: PartialEvaluationResult | null;
  streamingFeedback: string;
  result: EvaluationResult | null;
  error: string | null;
  errorCode: EvaluationErrorCode | null;
  currentStep: string | null;
  isCancelling: boolean;
}

/** Shape returned by `/api/evaluations/${challengeId}`. */
export interface EvaluationProgressResponse {
  status?: string;
  partial?: PartialEvaluationResult | null;
  streamingFeedback?: string;
  result?: EvaluationResult | null;
  error?: string;
  errorCode?: EvaluationErrorCode;
  currentStep?: string;
  jobId?: string;
}

export const initialEvaluationState: EvaluationState = {
  isLoading: false,
  partialResult: null,
  streamingFeedback: '',
  result: null,
  error: null,
  errorCode: null,
  currentStep: null,
  isCancelling: false,
};

/**
 * Merges a progress response into the previous evaluation state.
 *
 * Returns `null` for statuses (e.g. `cancelled`, missing) that should leave
 * the existing state untouched.
 */
export function applyProgress(
  progress: EvaluationProgressResponse,
  prev: EvaluationState
): EvaluationState | null {
  if (progress.status === 'streaming' || progress.status === 'pending') {
    return {
      ...prev,
      isLoading: true,
      partialResult: progress.partial || prev.partialResult,
      streamingFeedback: progress.streamingFeedback || prev.streamingFeedback,
      currentStep: progress.currentStep ?? prev.currentStep,
    };
  }
  if (progress.status === 'completed') {
    return {
      isLoading: false,
      partialResult: progress.partial || null,
      streamingFeedback: progress.streamingFeedback || '',
      result: progress.result || null,
      error: null,
      errorCode: null,
      currentStep: null,
      isCancelling: false,
    };
  }
  if (progress.status === 'failed') {
    return {
      isLoading: false,
      partialResult: null,
      streamingFeedback: '',
      result: null,
      error: progress.error || 'Evaluation failed',
      errorCode: progress.errorCode ?? null,
      currentStep: null,
      isCancelling: false,
    };
  }
  return null;
}

/**
 * useEvaluation Hook
 *
 * Owns challenge evaluation state, the 500ms polling loop, mount-time
 * recovery, and best-effort cancellation. Extracted from
 * `useChallengeSandbox` so the sandbox coordinator stays thin and the
 * polling/recovery behaviour can be tested in isolation.
 *
 * @see SPEC-002 for challenge sandbox requirements
 */

'use client';

import { apiGet, apiPost } from '@/lib/api-client';
import type {
  ChallengeDef,
  EvaluationResult,
  PartialEvaluationResult,
} from '@/lib/copilot/types';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Structured failure classifications surfaced from the jobs API so the
 * UI can route credentials-expired errors to a re-auth CTA instead of a
 * generic error banner.
 */
export type EvaluationErrorCode =
  | 'credentials_missing'
  | 'credentials_refresh_failed'
  | 'unknown';

/** Evaluation state during streaming */
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
interface EvaluationProgressResponse {
  status?: string;
  partial?: PartialEvaluationResult | null;
  streamingFeedback?: string;
  result?: EvaluationResult | null;
  error?: string;
  errorCode?: EvaluationErrorCode;
  currentStep?: string;
  jobId?: string;
}

export interface UseEvaluationOptions {
  challengeId: string;
  challenge: ChallengeDef;
  /** Snapshot of files for the next `evaluate()` call. Read lazily so the callback identity stays stable across keystrokes. */
  getFiles: () => Array<{ name: string; content: string }>;
  /** When true, on mount check the evaluation store and resume polling if an evaluation is in flight. */
  recoverOnMount?: boolean;
}

export interface UseEvaluationReturn {
  evaluation: EvaluationState;
  evaluate: () => Promise<void>;
  stopEvaluation: () => Promise<void>;
  /** Clear evaluation state synchronously. Fires DELETE best-effort but ignores late polling responses. */
  resetEvaluation: () => void;
}

const POLL_INTERVAL_MS = 500;

const initialEvaluationState: EvaluationState = {
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
 * Manage a single challenge's evaluation lifecycle.
 *
 * @param options - Challenge identifiers, lazy file accessor, and recovery toggle
 * @returns Evaluation state plus action callbacks
 */
export function useEvaluation(options: UseEvaluationOptions): UseEvaluationReturn {
  const { challengeId, challenge, getFiles, recoverOnMount = true } = options;

  const [evaluation, setEvaluation] = useState<EvaluationState>(initialEvaluationState);
  const evaluationJobIdRef = useRef<string | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Generation token: increments on every reset so in-flight pollers and
  // requests started before the reset cannot overwrite post-reset state.
  const generationRef = useRef(0);

  // Keep the latest file accessor without re-creating `evaluate`'s identity.
  const getFilesRef = useRef(getFiles);
  useEffect(() => {
    getFilesRef.current = getFiles;
  }, [getFiles]);

  const stopPollingInterval = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopPollingInterval();
    };
  }, [stopPollingInterval]);

  const startPolling = useCallback(() => {
    stopPollingInterval();
    const generation = generationRef.current;

    const poll = async () => {
      try {
        const progress = await apiGet<EvaluationProgressResponse | null>(
          `/api/evaluations/${challengeId}`,
          { throwOnError: false }
        );
        if (!progress) return;
        if (generation !== generationRef.current) return;

        if (progress.status === 'streaming' || progress.status === 'pending') {
          setEvaluation((prev) => ({
            ...prev,
            isLoading: true,
            partialResult: progress.partial || prev.partialResult,
            streamingFeedback: progress.streamingFeedback || prev.streamingFeedback,
            currentStep: progress.currentStep ?? prev.currentStep,
          }));
        } else if (progress.status === 'completed') {
          stopPollingInterval();
          evaluationJobIdRef.current = null;
          setEvaluation({
            isLoading: false,
            partialResult: progress.partial || null,
            streamingFeedback: progress.streamingFeedback || '',
            result: progress.result || null,
            error: null,
            errorCode: null,
            currentStep: null,
            isCancelling: false,
          });
        } else if (progress.status === 'failed') {
          stopPollingInterval();
          evaluationJobIdRef.current = null;
          setEvaluation({
            isLoading: false,
            partialResult: null,
            streamingFeedback: '',
            result: null,
            error: progress.error || 'Evaluation failed',
            errorCode: progress.errorCode ?? null,
            currentStep: null,
            isCancelling: false,
          });
        }
      } catch {
        // Transient polling errors continue the loop; 402s already broadcast globally.
      }
    };

    poll();
    pollingIntervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, [challengeId, stopPollingInterval]);

  useEffect(() => {
    if (!recoverOnMount) return;
    const generation = generationRef.current;

    const checkExistingEvaluation = async () => {
      try {
        const progress = await apiGet<EvaluationProgressResponse | null>(
          `/api/evaluations/${challengeId}`,
          { throwOnError: false }
        );
        if (!progress) return;
        if (generation !== generationRef.current) return;

        if (progress.status === 'pending' || progress.status === 'streaming') {
          evaluationJobIdRef.current = progress.jobId ?? null;
          setEvaluation({
            isLoading: true,
            partialResult: progress.partial || null,
            streamingFeedback: progress.streamingFeedback || '',
            result: null,
            error: null,
            errorCode: null,
            currentStep: progress.currentStep ?? null,
            isCancelling: false,
          });
          startPolling();
        } else if (progress.status === 'completed' && progress.result) {
          setEvaluation({
            isLoading: false,
            partialResult: progress.partial || null,
            streamingFeedback: progress.streamingFeedback || '',
            result: progress.result,
            error: null,
            errorCode: null,
            currentStep: null,
            isCancelling: false,
          });
        } else if (progress.status === 'failed') {
          setEvaluation({
            isLoading: false,
            partialResult: null,
            streamingFeedback: '',
            result: null,
            error: progress.error || 'Evaluation failed',
            errorCode: progress.errorCode ?? null,
            currentStep: null,
            isCancelling: false,
          });
        }
      } catch {
        // No existing evaluation is the expected steady state for most loads.
      }
    };

    checkExistingEvaluation();
  }, [challengeId, recoverOnMount, startPolling]);

  const evaluate = useCallback(async () => {
    if (evaluation.isLoading) return;

    setEvaluation({
      isLoading: true,
      partialResult: null,
      streamingFeedback: '',
      result: null,
      error: null,
      errorCode: null,
      currentStep: 'Preparing context…',
      isCancelling: false,
    });

    const files = getFilesRef.current();

    try {
      const response = await apiPost<{ id: string }>('/api/jobs', {
        type: 'challenge-evaluation',
        targetId: challengeId,
        input: {
          challengeId,
          challenge: {
            title: challenge.title,
            description: challenge.description,
            type: challenge.type,
            brokenCode: challenge.brokenCode,
            language: challenge.language,
            difficulty: challenge.difficulty,
            testCases: challenge.testCases ? JSON.stringify(challenge.testCases) : undefined,
          },
          files,
        },
      });

      if (response?.id) {
        evaluationJobIdRef.current = response.id;
        startPolling();
      } else {
        throw new Error('Failed to create evaluation job');
      }
    } catch (err) {
      setEvaluation({
        isLoading: false,
        partialResult: null,
        streamingFeedback: '',
        result: null,
        error: err instanceof Error ? err.message : 'Failed to start evaluation',
        errorCode: null,
        currentStep: null,
        isCancelling: false,
      });
    }
  }, [challenge, evaluation.isLoading, challengeId, startPolling]);

  const stopEvaluation = useCallback(async () => {
    // Optimistic "Cancelling…" — the polling loop clears isLoading when it
    // observes the final status, or the trailing setEvaluation handles the
    // no-job case.
    setEvaluation((prev) => ({ ...prev, isCancelling: true }));
    stopPollingInterval();

    const jobId = evaluationJobIdRef.current;
    if (jobId) {
      try {
        await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
      } catch {
        // Cancellation is best-effort; the server-side timeout still applies.
      }
      evaluationJobIdRef.current = null;
    }

    setEvaluation((prev) => ({
      ...prev,
      isLoading: false,
      isCancelling: false,
      currentStep: null,
    }));
  }, [stopPollingInterval]);

  const resetEvaluation = useCallback(() => {
    generationRef.current += 1;
    stopPollingInterval();
    const jobId = evaluationJobIdRef.current;
    evaluationJobIdRef.current = null;
    setEvaluation(initialEvaluationState);
    if (jobId) {
      void fetch(`/api/jobs/${jobId}`, { method: 'DELETE' }).catch(() => {
        // Cancellation is best-effort during reset; ignore failures.
      });
    }
  }, [stopPollingInterval]);

  return { evaluation, evaluate, stopEvaluation, resetEvaluation };
}

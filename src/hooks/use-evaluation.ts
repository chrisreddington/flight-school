/**
 * Owns challenge evaluation state, the 500ms polling loop, mount-time recovery,
 * and best-effort cancellation. State transitions for each progress status are
 * factored into {@link applyProgress} to keep this hook focused on the
 * polling/lifecycle wiring.
 *
 * @see SPEC-002 for challenge sandbox requirements
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { apiGet, apiPost } from '@/lib/api-client';
import type { ChallengeDef } from '@/lib/copilot/types';

import {
  applyProgress,
  initialEvaluationState,
  type EvaluationProgressResponse,
  type EvaluationState,
} from './evaluation-state';

export type { EvaluationErrorCode, EvaluationState } from './evaluation-state';

/**
 * Structured failure classifications surfaced from the jobs API so the UI can
 * route credentials-expired errors to a re-auth CTA instead of a generic
 * error banner.
 */

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

export function useEvaluation(options: UseEvaluationOptions): UseEvaluationReturn {
  const { challengeId, challenge, getFiles, recoverOnMount = true } = options;

  const [evaluation, setEvaluation] = useState<EvaluationState>(initialEvaluationState);
  const evaluationJobIdRef = useRef<string | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Increments on every reset so in-flight pollers/requests started before
  // the reset cannot overwrite post-reset state.
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

  useEffect(() => stopPollingInterval, [stopPollingInterval]);

  const fetchProgress = useCallback(
    () =>
      apiGet<EvaluationProgressResponse | null>(`/api/evaluations/${challengeId}`, {
        throwOnError: false,
      }),
    [challengeId],
  );

  const startPolling = useCallback(() => {
    stopPollingInterval();
    const generation = generationRef.current;

    const poll = async () => {
      try {
        const progress = await fetchProgress();
        if (!progress || generation !== generationRef.current) return;

        setEvaluation((prev) => {
          const next = applyProgress(progress, prev);
          if (!next) return prev;
          if (progress.status === 'completed' || progress.status === 'failed') {
            stopPollingInterval();
            evaluationJobIdRef.current = null;
          }
          return next;
        });
      } catch {
        // Transient polling errors continue the loop; 402s already broadcast globally.
      }
    };

    poll();
    pollingIntervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, [fetchProgress, stopPollingInterval]);

  useEffect(() => {
    if (!recoverOnMount) return;
    const generation = generationRef.current;

    const recover = async () => {
      try {
        const progress = await fetchProgress();
        if (!progress || generation !== generationRef.current) return;

        const next = applyProgress(progress, initialEvaluationState);
        if (!next) return;
        setEvaluation(next);
        if (progress.status === 'pending' || progress.status === 'streaming') {
          evaluationJobIdRef.current = progress.jobId ?? null;
          startPolling();
        }
      } catch {
        // No existing evaluation is the expected steady state for most loads.
      }
    };

    recover();
  }, [recoverOnMount, fetchProgress, startPolling]);

  const evaluate = useCallback(async () => {
    if (evaluation.isLoading) return;

    setEvaluation({
      ...initialEvaluationState,
      isLoading: true,
      currentStep: 'Preparing context…',
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

      if (!response?.id) throw new Error('Failed to create evaluation job');
      evaluationJobIdRef.current = response.id;
      startPolling();
    } catch (err) {
      setEvaluation({
        ...initialEvaluationState,
        error: err instanceof Error ? err.message : 'Failed to start evaluation',
      });
    }
  }, [challenge, evaluation.isLoading, challengeId, startPolling]);

  const cancelJob = useCallback(async (jobId: string) => {
    try {
      await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
    } catch {
      // Cancellation is best-effort; the server-side timeout still applies.
    }
  }, []);

  const stopEvaluation = useCallback(async () => {
    // Optimistic "Cancelling…" — polling clears isLoading once the final status
    // arrives, or the trailing setEvaluation handles the no-job case.
    setEvaluation((prev) => ({ ...prev, isCancelling: true }));
    stopPollingInterval();

    const jobId = evaluationJobIdRef.current;
    if (jobId) {
      await cancelJob(jobId);
      evaluationJobIdRef.current = null;
    }

    setEvaluation((prev) => ({
      ...prev,
      isLoading: false,
      isCancelling: false,
      currentStep: null,
    }));
  }, [stopPollingInterval, cancelJob]);

  const resetEvaluation = useCallback(() => {
    generationRef.current += 1;
    stopPollingInterval();
    const jobId = evaluationJobIdRef.current;
    evaluationJobIdRef.current = null;
    setEvaluation(initialEvaluationState);
    if (jobId) void cancelJob(jobId);
  }, [stopPollingInterval, cancelJob]);

  return { evaluation, evaluate, stopEvaluation, resetEvaluation };
}

/**
 * useChallengeSandbox Hook
 *
 * Manages state for the challenge sandbox component including:
 * - User's code input (single or multi-file workspace)
 * - Workspace persistence via localStorage
 * - Evaluation results (streaming)
 * - Hint requests and responses
 * - Loading and error states
 *
 * @example
 * ```typescript
 * const {
 *   workspace,
 *   evaluationResult,
 *   isEvaluating,
 *   evaluate,
 *   hints,
 *   isLoadingHint,
 *   requestHint,
 *   clearHints,
 *   reset,
 * } = useChallengeSandbox(challengeId, challenge);
 *
 * // Update code in active file
 * workspace.updateFileContent(workspace.activeFileId, newCode);
 *
 * // Run evaluation on all workspace files
 * await evaluate();
 *
 * // Request a hint
 * await requestHint('How do I start?');
 * ```
 *
 * @see SPEC-002 for challenge sandbox requirements
 * @see SPEC-004 for workspace persistence requirements
 */

'use client';

import { apiPost } from '@/lib/api-client';
import { now } from '@/lib/utils/date-utils';
import { generateHintId } from '@/lib/utils/id-generator';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
    ChallengeDef,
    EvaluationResult,
    HintResult,
    PartialEvaluationResult,
} from '@/lib/copilot/types';

import { useWorkspace, type UseWorkspaceReturn } from './use-workspace';

// ============================================================================
// Types
// ============================================================================

/** Hint with timestamp for display */
export interface HintMessage {
  /** Unique ID */
  id: string;
  /** User's question */
  question: string;
  /** AI's hint response */
  response: HintResult;
  /** When the hint was requested */
  timestamp: string;
}

/** Evaluation state during streaming */
export interface EvaluationState {
  /** Whether evaluation is in progress */
  isLoading: boolean;
  /** Partial metadata received before feedback (badge info) */
  partialResult: PartialEvaluationResult | null;
  /** Streaming feedback text (updates in real-time) */
  streamingFeedback: string;
  /** Final evaluation result */
  result: EvaluationResult | null;
  /** Error message if evaluation failed */
  error: string | null;
}

/** State returned by the useChallengeSandbox hook */
interface UseChallengeSandboxState {
  /** Workspace state (multi-file support) */
  workspace: UseWorkspaceReturn;
  /** Evaluation state */
  evaluation: EvaluationState;
  /** Convenience: whether evaluating */
  isEvaluating: boolean;
  /** Final evaluation result */
  evaluationResult: EvaluationResult | null;
  /** Hint conversation history */
  hints: HintMessage[];
  /** Whether a hint is being requested */
  isLoadingHint: boolean;
  /** Hint error message */
  hintError: string | null;
}

/** Actions provided by the useChallengeSandbox hook */
interface UseChallengeSandboxActions {
  /** Run evaluation on all workspace files */
  evaluate: () => Promise<void>;
  /** Stop current evaluation */
  stopEvaluation: () => void;
  /** Request a hint */
  requestHint: (question: string) => Promise<void>;
  /** Stop current hint request */
  stopHint: () => void;
  /** Clear all hints */
  clearHints: () => void;
  /** Reset sandbox to initial state (workspace reset + clear hints/evaluation) */
  reset: () => void;
  /** Generate and populate a solution (debug mode only) */
  solveChallengeWithAI: () => Promise<void>;
  /** Whether a solution is being generated */
  isSolving: boolean;
  /** Error from solution generation */
  solveError: string | null;
}

/** Return type of the useChallengeSandbox hook */
export type UseChallengeSandboxReturn = UseChallengeSandboxState & UseChallengeSandboxActions;

// ============================================================================
// Initial State
// ============================================================================

const initialEvaluationState: EvaluationState = {
  isLoading: false,
  partialResult: null,
  streamingFeedback: '',
  result: null,
  error: null,
};

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing challenge sandbox state.
 *
 * Provides state management for:
 * - Code editing (multi-file workspace)
 * - Streaming evaluation
 * - Progressive hints
 * - Workspace persistence
 *
 * @param challengeId - Unique identifier for the challenge (used for storage key)
 * @param challenge - The challenge definition
 * @returns Sandbox state and actions
 */
export function useChallengeSandbox(
  challengeId: string,
  challenge: ChallengeDef
): UseChallengeSandboxReturn {
  // Workspace state (manages files, persistence, auto-save)
  const workspace = useWorkspace(challengeId, challenge);

  // Evaluation state
  const [evaluation, setEvaluation] = useState<EvaluationState>(initialEvaluationState);

  // Hint state
  const [hints, setHints] = useState<HintMessage[]>([]);
  const [isLoadingHint, setIsLoadingHint] = useState(false);
  const [hintError, setHintError] = useState<string | null>(null);

  // Solution generation state
  const [isSolving, setIsSolving] = useState(false);
  const [solveError, setSolveError] = useState<string | null>(null);

  // Track current evaluation job ID for polling/cancellation
  const evaluationJobIdRef = useRef<string | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Polling interval for evaluation progress
  const POLL_INTERVAL_MS = 500;

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  // Start polling for evaluation progress
  const startPolling = useCallback((_jobId: string) => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
    
    const poll = async () => {
      try {
        // Check evaluation progress
        const response = await fetch(`/api/evaluations/${challengeId}`);
        if (!response.ok) return;
        
        const progress = await response.json();
        if (!progress) return;
        
        if (progress.status === 'streaming' || progress.status === 'pending') {
          setEvaluation((prev) => ({
            ...prev,
            isLoading: true,
            partialResult: progress.partial || prev.partialResult,
            streamingFeedback: progress.streamingFeedback || prev.streamingFeedback,
          }));
        } else if (progress.status === 'completed') {
          // Stop polling
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          evaluationJobIdRef.current = null;
          
          setEvaluation({
            isLoading: false,
            partialResult: progress.partial || null,
            streamingFeedback: progress.streamingFeedback || '',
            result: progress.result || null,
            error: null,
          });
        } else if (progress.status === 'failed') {
          // Stop polling
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          evaluationJobIdRef.current = null;
          
          setEvaluation({
            isLoading: false,
            partialResult: null,
            streamingFeedback: '',
            result: null,
            error: progress.error || 'Evaluation failed',
          });
        }
      } catch {
        // Polling error, continue trying
      }
    };
    
    // Initial poll
    poll();
    
    // Start interval
    pollingIntervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, [challengeId]);

  // Check for existing evaluation on mount (recovers state if navigated away and back)
  useEffect(() => {
    const checkExistingEvaluation = async () => {
      try {
        // Check evaluation storage for existing progress
        const response = await fetch(`/api/evaluations/${challengeId}`);
        if (response.ok) {
          const progress = await response.json();
          if (progress && (progress.status === 'pending' || progress.status === 'streaming')) {
            // Resume polling for this evaluation
            evaluationJobIdRef.current = progress.jobId;
            setEvaluation({
              isLoading: true,
              partialResult: progress.partial || null,
              streamingFeedback: progress.streamingFeedback || '',
              result: null,
              error: null,
            });
            startPolling(progress.jobId);
          } else if (progress?.status === 'completed' && progress.result) {
            setEvaluation({
              isLoading: false,
              partialResult: progress.partial || null,
              streamingFeedback: progress.streamingFeedback || '',
              result: progress.result,
              error: null,
            });
          }
        }
      } catch {
        // No existing evaluation, that's fine
      }
    };
    
    checkExistingEvaluation();
  }, [challengeId, startPolling]);

  /**
   * Run evaluation on all workspace files using background job.
   * Evaluation continues in background if user navigates away.
   */
  const evaluate = useCallback(async () => {
    // Don't start new evaluation if already in progress
    if (evaluation.isLoading) return;

    setEvaluation({
      isLoading: true,
      partialResult: null,
      streamingFeedback: '',
      result: null,
      error: null,
    });

    // Build files array for evaluation
    const files = workspace.files.map((f) => ({
      name: f.name,
      content: f.content,
    }));

    try {
      // Start evaluation via jobs API
      const response = await apiPost<{ id: string }>('/api/jobs', {
        type: 'challenge-evaluation',
        targetId: challengeId,
        input: {
          challengeId,
          challenge: {
            title: challenge.title,
            description: challenge.description,
            language: challenge.language,
            difficulty: challenge.difficulty,
            testCases: challenge.testCases ? JSON.stringify(challenge.testCases) : undefined,
          },
          files,
        },
      });

      if (response?.id) {
        evaluationJobIdRef.current = response.id;
        startPolling(response.id);
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
      });
    }
  }, [challenge, workspace.files, evaluation.isLoading, challengeId, startPolling]);

  /**
   * Stop the current evaluation.
   */
  const stopEvaluation = useCallback(async () => {
    // Stop polling
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    
    // Cancel the job if we have one
    if (evaluationJobIdRef.current) {
      try {
        await fetch(`/api/jobs/${evaluationJobIdRef.current}`, { method: 'DELETE' });
      } catch {
        // Ignore cancellation errors
      }
      evaluationJobIdRef.current = null;
    }
    
    setEvaluation((prev) => ({
      ...prev,
      isLoading: false,
    }));
  }, []);

  // Hint abort controller
  const hintAbortControllerRef = useRef<AbortController | null>(null);

  /**
   * Request a hint for the current challenge.
   */
  const requestHint = useCallback(
    async (question: string) => {
      if (isLoadingHint) return;

      // Cancel any existing hint request
      if (hintAbortControllerRef.current) {
        hintAbortControllerRef.current.abort();
      }

      const controller = new AbortController();
      hintAbortControllerRef.current = controller;

      setIsLoadingHint(true);
      setHintError(null);

      try {
        const data = await apiPost<{
          success: boolean;
          hint: string;
          isFinalHint?: boolean;
          concepts?: string[];
          suggestedFollowUp?: string;
          error?: string;
        }>('/api/challenge/hint', {
          challenge,
          question,
          currentCode: workspace.files.find((f) => f.id === workspace.activeFileId)?.content ?? '',
        }, {
          timeout: 60000, // 1 minute for hint generation
          signal: controller.signal,
        });

        if (!data.success) {
          throw new Error(data.error || 'Failed to get hint');
        }

        const hintMessage: HintMessage = {
          id: generateHintId(),
          question,
          response: {
            hint: data.hint,
            isFinalHint: data.isFinalHint ?? false,
            concepts: data.concepts,
            suggestedFollowUp: data.suggestedFollowUp,
          },
          timestamp: now(),
        };

        setHints((prev) => [...prev, hintMessage]);
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          // Request was cancelled - don't show error
          return;
        }
        const errorMessage = error instanceof Error ? error.message : 'Failed to get hint';
        setHintError(errorMessage);
      } finally {
        hintAbortControllerRef.current = null;
        setIsLoadingHint(false);
      }
    },
    [challenge, workspace, isLoadingHint]
  );

  /**
   * Stop the current hint request.
   */
  const stopHint = useCallback(() => {
    if (hintAbortControllerRef.current) {
      hintAbortControllerRef.current.abort();
      hintAbortControllerRef.current = null;
    }
  }, []);

  /**
   * Clear all hints.
   */
  const clearHints = useCallback(() => {
    setHints([]);
    setHintError(null);
  }, []);

  /**
   * Generate a solution for the challenge using AI (debug mode only).
   * Populates all workspace files with the generated solutions.
   */
  const solveChallengeWithAI = useCallback(async () => {
    if (isSolving) return;

    setIsSolving(true);
    setSolveError(null);

    try {
      // Build files array for the API
      const files = workspace.files.map((f) => ({
        name: f.name,
        content: f.content,
      }));

      const data = await apiPost<{
        success: boolean;
        files?: Array<{ name: string; content: string }>;
        error?: string;
      }>('/api/challenge/solve', {
        challenge,
        files,
      }, {
        timeout: 120000, // 2 minutes for AI generation
      });

      if (!data.success || !data.files) {
        throw new Error(data.error || 'Failed to generate solution');
      }

      // Populate all workspace files with the generated solutions
      if (data.files && Array.isArray(data.files)) {
        for (const generatedFile of data.files) {
          // Find matching workspace file by name
          const workspaceFile = workspace.files.find(
            (f) => f.name === generatedFile.name
          );
          if (workspaceFile) {
            workspace.updateFileContent(workspaceFile.id, generatedFile.content);
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate solution';
      setSolveError(errorMessage);
    } finally {
      setIsSolving(false);
    }
  }, [challenge, isSolving, workspace]);

  /**
   * Reset sandbox to initial state.
   * Resets workspace to template and clears hints/evaluation.
   */
  const reset = useCallback(() => {
    // Cancel any in-flight evaluation
    stopEvaluation();

    // Reset workspace to template
    workspace.reset();

    // Clear evaluation and hints
    setEvaluation(initialEvaluationState);
    setHints([]);
    setIsLoadingHint(false);
    setHintError(null);
    setIsSolving(false);
    setSolveError(null);
  }, [workspace, stopEvaluation]);

  return {
    // State
    workspace,
    evaluation,
    isEvaluating: evaluation.isLoading,
    evaluationResult: evaluation.result,
    hints,
    isLoadingHint,
    hintError,
    isSolving,
    solveError,
    // Actions
    evaluate,
    stopEvaluation,
    requestHint,
    stopHint,
    clearHints,
    reset,
    solveChallengeWithAI,
  };
}

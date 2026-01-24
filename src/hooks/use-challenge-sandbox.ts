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
import { useCallback, useRef, useState } from 'react';

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

  // Abort controller for cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Run evaluation on all workspace files using streaming API.
   */
  const evaluate = useCallback(async () => {
    // Don't start new evaluation if already in progress
    if (evaluation.isLoading) return;

    // Cancel any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setEvaluation({
      isLoading: true,
      partialResult: null,
      streamingFeedback: '',
      result: null,
      error: null,
    });

    try {
      // Build files array for evaluation
      const files = workspace.files.map((f) => ({
        name: f.name,
        content: f.content,
      }));

      const response = await fetch('/api/challenge/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge, files }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let streamedFeedback = '';
      let finalResult: EvaluationResult | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);

          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);

            if (event.type === 'partial') {
              // Early metadata - show badge immediately
              setEvaluation((prev) => ({
                ...prev,
                partialResult: {
                  isCorrect: event.isCorrect,
                  score: event.score,
                  strengths: event.strengths || [],
                  improvements: event.improvements || [],
                  nextSteps: event.nextSteps,
                },
              }));
            } else if (event.type === 'feedback-delta') {
              // Streaming feedback text
              streamedFeedback += event.content;
              setEvaluation((prev) => ({
                ...prev,
                streamingFeedback: streamedFeedback,
              }));
            } else if (event.type === 'result') {
              finalResult = {
                isCorrect: event.isCorrect,
                feedback: event.feedback,
                strengths: event.strengths || [],
                improvements: event.improvements || [],
                score: event.score,
                nextSteps: event.nextSteps,
              };
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          } catch {
            // Ignore parse errors for partial lines
          }
        }
      }

      setEvaluation((prev) => ({
        isLoading: false,
        partialResult: prev.partialResult,
        streamingFeedback: streamedFeedback,
        result: finalResult,
        error: null,
      }));
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // Request was cancelled
        setEvaluation((prev) => ({
          ...prev,
          isLoading: false,
        }));
        return;
      }

      const errorMessage = error instanceof Error ? error.message : 'Evaluation failed';
      setEvaluation({
        isLoading: false,
        partialResult: null,
        streamingFeedback: '',
        result: null,
        error: errorMessage,
      });
    } finally {
      abortControllerRef.current = null;
    }
  }, [challenge, workspace.files, evaluation.isLoading]);

  /**
   * Stop the current evaluation.
   */
  const stopEvaluation = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  /**
   * Request a hint for the current challenge.
   */
  const requestHint = useCallback(
    async (question: string) => {
      if (isLoadingHint) return;

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
        const errorMessage = error instanceof Error ? error.message : 'Failed to get hint';
        setHintError(errorMessage);
      } finally {
        setIsLoadingHint(false);
      }
    },
    [challenge, workspace, isLoadingHint]
  );

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
    // Cancel any in-flight requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Reset workspace to template
    workspace.reset();

    // Clear evaluation and hints
    setEvaluation(initialEvaluationState);
    setHints([]);
    setIsLoadingHint(false);
    setHintError(null);
    setIsSolving(false);
    setSolveError(null);
  }, [workspace]);

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
    clearHints,
    reset,
    solveChallengeWithAI,
  };
}

/**
 * useChallengeSandbox Hook
 *
 * Thin coordinator for the challenge sandbox. Composes
 * `useWorkspace` (multi-file editor), `useEvaluation` (job polling +
 * recovery), `useHints` (progressive hints), and
 * `useSolutionGeneration` (debug solver) into the unified return shape
 * the sandbox UI consumes.
 *
 * @see SPEC-002 for challenge sandbox requirements
 * @see SPEC-004 for workspace persistence requirements
 */

'use client';

import type { ChallengeDef, EvaluationResult } from '@/lib/copilot/types';
import { useCallback } from 'react';

import { useEvaluation, type EvaluationState } from './use-evaluation';
import { useHints, type HintMessage } from './use-hints';
import { useSolutionGeneration } from './use-solution-generation';
import { useWorkspace, type UseWorkspaceReturn } from './use-workspace';

export type { EvaluationErrorCode, EvaluationState } from './use-evaluation';
export type { HintMessage } from './use-hints';

interface UseChallengeSandboxReturn {
  workspace: UseWorkspaceReturn;
  evaluation: EvaluationState;
  isEvaluating: boolean;
  evaluationResult: EvaluationResult | null;
  hints: HintMessage[];
  isLoadingHint: boolean;
  hintError: string | null;
  evaluate: () => Promise<void>;
  stopEvaluation: () => Promise<void>;
  requestHint: (question: string) => Promise<void>;
  stopHint: () => void;
  clearHints: () => void;
  reset: () => void;
  solveChallengeWithAI: () => Promise<void>;
  isSolving: boolean;
  solveError: string | null;
}

/**
 * Compose sandbox state for a single challenge.
 *
 * @param challengeId - Storage key for the workspace
 * @param challenge - Challenge definition driving evaluation and hints
 */
export function useChallengeSandbox(challengeId: string, challenge: ChallengeDef): UseChallengeSandboxReturn {
  const workspace = useWorkspace(challengeId, challenge);

  const evaluationHook = useEvaluation({
    challengeId,
    challenge,
    getFiles: useCallback(() => workspace.files.map((f) => ({ name: f.name, content: f.content })), [workspace.files]),
  });

  const hintsHook = useHints({
    challenge,
    getCurrentCode: useCallback(
      () => workspace.files.find((f) => f.id === workspace.activeFileId)?.content ?? '',
      [workspace.files, workspace.activeFileId],
    ),
  });

  const solverHook = useSolutionGeneration({ challenge, workspace });

  const reset = useCallback(() => {
    evaluationHook.resetEvaluation();
    workspace.reset();
    hintsHook.resetHints();
    solverHook.resetSolutionGeneration();
  }, [evaluationHook, workspace, hintsHook, solverHook]);

  return {
    workspace,
    evaluation: evaluationHook.evaluation,
    isEvaluating: evaluationHook.evaluation.isLoading,
    evaluationResult: evaluationHook.evaluation.result,
    hints: hintsHook.hints,
    isLoadingHint: hintsHook.isLoadingHint,
    hintError: hintsHook.hintError,
    evaluate: evaluationHook.evaluate,
    stopEvaluation: evaluationHook.stopEvaluation,
    requestHint: hintsHook.requestHint,
    stopHint: hintsHook.stopHint,
    clearHints: hintsHook.clearHints,
    reset,
    solveChallengeWithAI: solverHook.solveChallengeWithAI,
    isSolving: solverHook.isSolving,
    solveError: solverHook.solveError,
  };
}

/**
 * useSolutionGeneration Hook
 *
 * Debug-mode helper that asks the worker to generate solutions and
 * applies them to the active workspace. Extracted from
 * `useChallengeSandbox`.
 */

'use client';

import { apiPost } from '@/lib/api-client';
import type { ChallengeDef } from '@/lib/copilot/types';
import { useCallback, useState } from 'react';

import type { UseWorkspaceReturn } from './use-workspace';

export interface UseSolutionGenerationOptions {
  challenge: ChallengeDef;
  workspace: UseWorkspaceReturn;
}

export interface UseSolutionGenerationReturn {
  isSolving: boolean;
  solveError: string | null;
  solveChallengeWithAI: () => Promise<void>;
  resetSolutionGeneration: () => void;
}

const SOLVE_TIMEOUT_MS = 120_000;

/**
 * Generate workspace solutions for a challenge (debug only).
 */
export function useSolutionGeneration(
  options: UseSolutionGenerationOptions
): UseSolutionGenerationReturn {
  const { challenge, workspace } = options;

  const [isSolving, setIsSolving] = useState(false);
  const [solveError, setSolveError] = useState<string | null>(null);

  const solveChallengeWithAI = useCallback(async () => {
    if (isSolving) return;

    setIsSolving(true);
    setSolveError(null);

    try {
      const files = workspace.files.map((f) => ({ name: f.name, content: f.content }));

      const data = await apiPost<{
        success: boolean;
        files?: Array<{ name: string; content: string }>;
        error?: string;
      }>('/api/challenge/solve', { challenge, files }, { timeout: SOLVE_TIMEOUT_MS });

      if (!data.success || !data.files) {
        throw new Error(data.error || 'Failed to generate solution');
      }

      for (const generated of data.files) {
        const target = workspace.files.find((f) => f.name === generated.name);
        if (target) {
          workspace.updateFileContent(target.id, generated.content);
        }
      }
    } catch (error) {
      setSolveError(error instanceof Error ? error.message : 'Failed to generate solution');
    } finally {
      setIsSolving(false);
    }
  }, [challenge, isSolving, workspace]);

  const resetSolutionGeneration = useCallback(() => {
    setIsSolving(false);
    setSolveError(null);
  }, []);

  return { isSolving, solveError, solveChallengeWithAI, resetSolutionGeneration };
}

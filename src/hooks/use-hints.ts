/**
 * useHints Hook
 *
 * Owns the progressive-hint conversation for a single challenge: the
 * hint list, the in-flight abort controller, and the request/cancel/clear
 * commands. Extracted from `useChallengeSandbox`.
 */

'use client';

import { apiPost } from '@/lib/api-client';
import type { ChallengeDef, HintResult } from '@/lib/copilot/types';
import { now } from '@/lib/utils/date-utils';
import { generateHintId } from '@/lib/utils/id-generator';
import { useCallback, useRef, useState } from 'react';

/** Hint with timestamp for display */
export interface HintMessage {
  id: string;
  question: string;
  response: HintResult;
  timestamp: string;
}

export interface UseHintsOptions {
  challenge: ChallengeDef;
  /** Lazy accessor for the active file's content. Called inside `requestHint` so file switches between user actions are observed correctly. */
  getCurrentCode: () => string;
}

export interface UseHintsReturn {
  hints: HintMessage[];
  isLoadingHint: boolean;
  hintError: string | null;
  requestHint: (question: string) => Promise<void>;
  stopHint: () => void;
  clearHints: () => void;
  /** Full reset for sandbox-level reset: stops in-flight hint + clears history + error. */
  resetHints: () => void;
}

const HINT_TIMEOUT_MS = 60_000;

/**
 * Manage the progressive-hint conversation for one challenge.
 */
export function useHints(options: UseHintsOptions): UseHintsReturn {
  const { challenge, getCurrentCode } = options;

  const [hints, setHints] = useState<HintMessage[]>([]);
  const [isLoadingHint, setIsLoadingHint] = useState(false);
  const [hintError, setHintError] = useState<string | null>(null);

  const hintAbortControllerRef = useRef<AbortController | null>(null);
  const getCurrentCodeRef = useRef(getCurrentCode);
  getCurrentCodeRef.current = getCurrentCode;

  const requestHint = useCallback(
    async (question: string) => {
      if (isLoadingHint) return;

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
        }>(
          '/api/challenge/hint',
          {
            challenge,
            question,
            currentCode: getCurrentCodeRef.current(),
          },
          { timeout: HINT_TIMEOUT_MS, signal: controller.signal }
        );

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
        if ((error as Error).name === 'AbortError') return;
        setHintError(error instanceof Error ? error.message : 'Failed to get hint');
      } finally {
        hintAbortControllerRef.current = null;
        setIsLoadingHint(false);
      }
    },
    [challenge, isLoadingHint]
  );

  const stopHint = useCallback(() => {
    if (hintAbortControllerRef.current) {
      hintAbortControllerRef.current.abort();
      hintAbortControllerRef.current = null;
    }
  }, []);

  const clearHints = useCallback(() => {
    setHints([]);
    setHintError(null);
  }, []);

  const resetHints = useCallback(() => {
    if (hintAbortControllerRef.current) {
      hintAbortControllerRef.current.abort();
      hintAbortControllerRef.current = null;
    }
    setHints([]);
    setIsLoadingHint(false);
    setHintError(null);
  }, []);

  return { hints, isLoadingHint, hintError, requestHint, stopHint, clearHints, resetHints };
}

/**
 * ChallengeSandbox Types
 *
 * Type definitions for the challenge sandbox component.
 */

import type { ChallengeDef, EvaluationResult } from '@/lib/copilot/types';

/** Props for the ChallengeSandbox component */
export interface ChallengeSandboxProps {
  /** Unique ID for this challenge (used for workspace persistence) */
  challengeId: string;
  /** The challenge definition */
  challenge: ChallengeDef;
  /** Callback when challenge is completed (correct solution) */
  onComplete?: (result: EvaluationResult) => void;
  /** Whether to auto-focus the editor on mount */
  autoFocus?: boolean;
}

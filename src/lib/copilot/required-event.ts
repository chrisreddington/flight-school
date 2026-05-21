/**
 * Shared event constants for the P5 "Copilot required" UI signal.
 *
 * Lives in `src/lib/copilot/` so both server-side helpers and client-side
 * fetch wrappers can import without pulling React.
 */

export const COPILOT_REQUIRED_EVENT = 'copilot-required';

export interface CopilotRequiredEventDetail {
  /** Friendly message lifted from the 402 body. */
  message?: string;
  /** Sign-up URL lifted from the 402 body. */
  signUpUrl?: string;
  /** Originating endpoint (for telemetry / debugging). */
  endpoint?: string;
}

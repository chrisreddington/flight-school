/**
 * Content Detection Utilities
 *
 * Utilities for detecting patterns and analyzing content.
 *
 * @module utils/content-detection
 */

// =============================================================================
// Actionable Content Detection
// =============================================================================

/**
 * Patterns that indicate actionable content in AI responses.
 *
 * Used to detect when responses contain follow-up suggestions,
 * exercises, or next steps - enabling smart action UI in Step 4.
 */
const ACTIONABLE_PATTERNS = [
  // Follow-up questions/exploration
  /you (?:could|might|can) (?:try|explore|look into|experiment with)/i,
  /(?:try|consider) (?:running|using|implementing|adding)/i,
  /(?:next|follow.?up) (?:steps?|questions?|exercises?)/i,
  /here(?:'s| is| are) (?:an? )?(?:exercise|challenge|experiment)/i,
  // Numbered suggestions
  /\b[1-3]\.\s+(?:try|explore|what if|consider|how about)/i,
  // Direct suggestions
  /to (?:deepen|further|continue) your understanding/i,
  /(?:practice|hands-?on) exercise/i,
];

/**
 * Detect if response contains actionable items like follow-up suggestions.
 *
 * This enables the UI to show smart action buttons (AC1.4 from SPEC-001).
 *
 * @param content - The full response content
 * @returns Whether the response contains actionable suggestions
 */
export function detectActionableContent(content: string): boolean {
  return ACTIONABLE_PATTERNS.some((pattern) => pattern.test(content));
}

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
  return ACTIONABLE_PATTERNS.some(pattern => pattern.test(content));
}

// =============================================================================
// GitHub Tools Detection
// =============================================================================

/** Keywords that suggest user wants GitHub tools */
const GITHUB_KEYWORDS = [
  'github', 'repo', 'repository', 'explore repo', 'explore repository', 'search code',
];

/**
 * Check if prompt suggests need for GitHub tools.
 *
 * Detects keywords that indicate the user wants to explore GitHub
 * repositories or search code.
 *
 * @param prompt - User's prompt text
 * @returns Whether the prompt suggests GitHub tools are needed
 */
export function needsGitHubTools(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return GITHUB_KEYWORDS.some(kw => lower.includes(kw));
}

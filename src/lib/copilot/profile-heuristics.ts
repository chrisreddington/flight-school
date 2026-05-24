/**
 * Profile elevation heuristics — pure, token-boundary-matched predicates
 * used by `./profiles` to upgrade a base profile when the user prompt
 * clearly references a capability domain.
 *
 * Pure module — no SDK imports. Uses word boundaries so subword matches
 * (e.g. `"repo"` inside `"report"`) cannot trigger.
 */

/**
 * Token-boundary keywords that signal the user is asking about a
 * GitHub repository or code search. Each entry must be wrapped in `\b…\b`
 * so subword matches (e.g. `"repo"` inside `"report"`) cannot trigger.
 */
const GITHUB_KEYWORD_PATTERN =
  /\b(?:github|repos?|repository|repositories|pull[\s-]?requests?|prs?|issues?|commits?|branches?|search\s+code)\b/i;

/**
 * Returns true when the prompt clearly references the GitHub capability
 * domain. Used by the `chat-default` profile to elevate itself from
 * `[]` to `['github']`.
 *
 * Pure and synchronous — must not block the chat hot path.
 */
export function needsGitHubCapability(prompt: string): boolean {
  return GITHUB_KEYWORD_PATTERN.test(prompt);
}

/**
 * GitHub Validation Utilities
 *
 * Reusable validation functions for GitHub-related inputs.
 */

/**
 * Validates a GitHub repository name.
 *
 * Rules:
 * - Required (non-empty string)
 * - Max 100 characters
 * - Only alphanumeric, hyphens, and underscores
 * - Cannot start or end with hyphen
 *
 * @param name - Repository name to validate
 * @returns Error message if invalid, null if valid
 *
 * @example
 * ```typescript
 * const error = validateRepoName('my-repo');
 * if (error) {
 *   return NextResponse.json({ error }, { status: 400 });
 * }
 * ```
 */
export function validateRepoName(name: string): string | null {
  if (!name || typeof name !== 'string') {
    return 'Repository name is required';
  }

  if (name.length > 100) {
    return 'Repository name must be 100 characters or less';
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return 'Repository name can only contain letters, numbers, hyphens, and underscores';
  }

  if (name.startsWith('-') || name.endsWith('-')) {
    return 'Repository name cannot start or end with a hyphen';
  }

  return null;
}

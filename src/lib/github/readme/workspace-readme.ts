/**
 * Workspace Export README Generation
 *
 * Generates README and HINTS files for exported challenge workspaces.
 */

// =============================================================================
// Types
// =============================================================================

/** File in the workspace to export */
export interface WorkspaceExportFileInput {
  name: string;
  content: string;
}

/** Challenge definition for README generation */
export interface WorkspaceExportChallengeMetadata {
  title: string;
  description: string;
  language: string;
  difficulty: string;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Generates README content for an exported repository.
 *
 * @param challenge - Challenge metadata
 * @param files - Files being exported
 * @param evaluation - Optional evaluation summary
 * @returns README markdown content
 */
export function generateWorkspaceReadme(
  challenge: WorkspaceExportChallengeMetadata,
  files: WorkspaceExportFileInput[],
  evaluation?: string
): string {
  const fileList = files.map((f) => `- \`${f.name}\``).join('\n');

  let content = `# ${challenge.title}

**Language**: ${challenge.language}  
**Difficulty**: ${challenge.difficulty}

## Challenge Description

${challenge.description}

## Solution Files

${fileList}

`;

  if (evaluation) {
    content += `## Evaluation Summary

${evaluation}

`;
  }

  content += `## How to Run

\`\`\`bash
# Clone the repository
git clone <this-repo-url>
cd <repo-name>

# Run the solution (adjust based on language)
# TypeScript: npx ts-node solution.ts
# Python: python solution.py
# Java: javac Solution.java && java Solution
\`\`\`

---

*Exported from [Flight School](https://github.com/chrisreddington/flight-school) using [GitHub Copilot SDK](https://github.com/github/copilot-sdk)*
`;

  return content;
}

/**
 * Generates HINTS.md content if hints were used.
 *
 * @param hints - Array of hints used during the challenge
 * @returns HINTS markdown content
 */
export function generateWorkspaceHintsFile(hints: string[]): string {
  let content = `# Hints Used

These hints were provided during the challenge:

`;

  hints.forEach((hint, index) => {
    content += `## Hint ${index + 1}

${hint}

`;
  });

  content += `---

*Recorded by [Flight School](https://github.com/chrisreddington/flight-school) using [GitHub Copilot SDK](https://github.com/github/copilot-sdk)*
`;

  return content;
}

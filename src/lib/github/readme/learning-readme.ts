/**
 * Learning README Generation
 *
 * Uses the Copilot SDK to generate README files for learning repositories.
 */

import { createLoggedLightweightCoachSession } from '@/lib/copilot/server';
import { logger } from '@/lib/logger';
import { extractJSON } from '@/lib/utils/json-utils';

const log = logger.withTag('README Generator');

// =============================================================================
// Types
// =============================================================================

/** Options for README generation */
export interface ReadmeGenerationOptions {
  /** Repository name */
  repoName: string;
  /** Learning topic */
  topic: string;
  /** Optional description */
  description?: string;
}

// =============================================================================
// Prompt Template
// =============================================================================

/**
 * System prompt template for README generation.
 */
const README_GENERATION_PROMPT = `Generate a README.md for a learning project repository.

**Repository**: {{repoName}}
**Topic**: {{topic}}
{{description}}

Create a well-structured README with:
1. Title and badges placeholder
2. Description of what this repo is for (learning {{topic}})
3. Learning objectives (3-5 bullet points)
4. Getting started section
5. Resources section with placeholder links
6. Progress tracking section with checkboxes

Return JSON:
{
  "readme": "# Title\\n\\nContent here..."
}

Return ONLY the JSON.`;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extracts README content from AI response with multiple fallback strategies.
 */
function extractReadmeFromResponse(responseText: string): string | null {
  const parsed = extractJSON<{ readme: string }>(responseText);
  if (parsed?.readme) {
    return parsed.readme;
  }

  const markdownMatch = responseText.match(/```markdown\s*([\s\S]*?)```/);
  if (markdownMatch) {
    return markdownMatch[1].trim();
  }

  if (responseText.trim().startsWith('#')) {
    return responseText.trim();
  }

  return null;
}

/**
 * Creates a fallback README when AI generation fails.
 */
function createFallbackReadme(options: ReadmeGenerationOptions): string {
  const { repoName, topic, description } = options;
  return `# ${repoName}

## Learning: ${topic}

${description || `A repository for learning and practicing ${topic}.`}

## Getting Started

1. Clone this repository
2. Start exploring the code
3. Document your learnings

---
*Created via [Flight School](https://github.com/chrisreddington/flight-school) using [GitHub Copilot SDK](https://github.com/github/copilot-sdk)*`;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Generates a README using the Copilot SDK.
 *
 * @param options - README generation options
 * @returns Generated or fallback README content
 */
export async function generateLearningReadme(
  options: ReadmeGenerationOptions
): Promise<string> {
  const { repoName, topic, description } = options;

  const prompt = README_GENERATION_PROMPT
    .replace('{{repoName}}', repoName)
    .replace('{{topic}}', topic)
    .replace('{{topic}}', topic)
    .replace('{{description}}', description ? `**Description**: ${description}` : '');

  try {
    const loggedSession = await createLoggedLightweightCoachSession(
      'README Generation',
      'Generate README for learning repository'
    );

    const result = await loggedSession.sendAndWait(prompt);
    loggedSession.destroy();

    const extractedReadme = extractReadmeFromResponse(result.responseText);
    if (extractedReadme) {
      log.info(`README generated successfully for ${repoName}`);
      return extractedReadme;
    }

    throw new Error('Could not parse README from AI response');
  } catch (error) {
    log.error('README generation failed, using fallback:', error);
    return createFallbackReadme(options);
  }
}

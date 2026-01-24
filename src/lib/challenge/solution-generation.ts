/**
 * Challenge solution generation prompts.
 */

import type { ChallengeDef } from '@/lib/copilot/types';

/**
 * System prompt for generating challenge solutions.
 */
export const SOLUTION_GENERATION_PROMPT = `You are a code solution generator for a developer learning platform.

Your role is to generate complete, working solutions to coding challenges across multiple files.

## Guidelines

1. **Correctness**: The solution must fully meet all challenge requirements
2. **Best Practices**: Use idiomatic code for the language
3. **Clarity**: Write clean, readable code with appropriate comments
4. **Completeness**: Include all necessary imports, function signatures, etc.
5. **Edge Cases**: Handle boundary conditions properly
6. **Multi-file Support**: Generate appropriate code for each file (main solution, tests, helpers)

## Response Format

You MUST format your response EXACTLY like this:

\`\`\`json
{
  "files": [
    {
      "name": "solution.ts",
      "content": "// Complete code solution here"
    },
    {
      "name": "solution.test.ts",
      "content": "// Complete test code here"
    }
  ],
  "explanation": "Brief explanation of the approach in 1-2 sentences"
}
\`\`\`

IMPORTANT: 
- The "files" array must contain an entry for EACH file provided in the workspace
- Each "content" field must contain ONLY the code, ready to run
- No markdown code blocks within the content strings
- The explanation should be brief but mention the key algorithmic approach`;

/**
 * Builds the solution generation prompt for a specific challenge.
 */
export function buildSolutionPrompt(
  challenge: ChallengeDef,
  files: Array<{ name: string; content: string }>
): string {
  let prompt = `Generate a complete, working solution for this ${challenge.language} coding challenge:

## Challenge: ${challenge.title}
**Difficulty**: ${challenge.difficulty}

### Instructions
${challenge.description}
`;

  if (challenge.expectedPatterns && challenge.expectedPatterns.length > 0) {
    prompt += `
### Expected Patterns
The solution should demonstrate: ${challenge.expectedPatterns.join(', ')}
`;
  }

  if (challenge.testCases && challenge.testCases.length > 0) {
    prompt += `
### Test Cases to Satisfy
${challenge.testCases
  .map((tc, i) => `${i + 1}. Input: ${tc.input} → Expected: ${tc.expectedOutput}${tc.description ? ` (${tc.description})` : ''}`)
  .join('\n')}
`;
  }

  prompt += `
## Workspace Files
You need to generate solutions for the following files:
${files.map((f) => `- ${f.name}: ${f.content ? 'Has starter code' : 'Empty'}`).join('\n')}

## Your Task
Generate complete code for EACH file using the EXACT JSON format from your system instructions.
The solutions must:
1. Be syntactically correct ${challenge.language} code
2. Handle all specified test cases
3. Follow best practices for the language
4. Include helpful comments explaining the approach
5. Work together across files (e.g., tests should import and test the solution)

Remember: Output JSON with "files" array and "explanation" fields only!`;

  return prompt;
}

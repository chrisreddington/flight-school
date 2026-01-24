/**
 * Challenge Evaluation Module
 *
 * Provides AI-powered evaluation of coding challenge solutions using the Copilot SDK.
 * Evaluates correctness, provides feedback, and suggests improvements.
 *
 * @remarks
 * The evaluation system prompt is designed to:
 * 1. Detect correct vs incorrect solutions
 * 2. Provide constructive feedback
 * 3. Suggest specific improvements
 * 4. Avoid giving away the full solution in feedback
 *
 * Supports both single-file and multi-file workspace submissions.
 *
 * @see SPEC-002 for acceptance criteria (AC2.1-AC2.4)
 */

import { extractJSON } from '@/lib/utils/json-utils';
import type {
    ChallengeDef,
    EvaluationResult,
    PartialEvaluationResult,
} from './types';

// =============================================================================
// Types
// =============================================================================

/**
 * A file in a workspace submission for evaluation.
 */
export interface WorkspaceFileInput {
  /** File name (e.g., 'solution.ts') */
  name: string;
  /** File content */
  content: string;
}

/**
 * System prompt for challenge evaluation.
 *
 * @remarks
 * This prompt is designed to:
 * - Evaluate code correctness based on challenge requirements
 * - Provide specific, actionable feedback
 * - Not give away the full solution in hints
 * - Be encouraging while honest about issues
 * 
 * The format outputs JSON metadata FIRST for early parsing,
 * then streams the feedback text for real-time display.
 */
export const EVALUATION_SYSTEM_PROMPT = `You are a code evaluation assistant for a developer learning platform.

Your role is to evaluate coding challenge solutions and provide constructive feedback.

## Guidelines

1. **Correctness**: Determine if the solution meets the challenge requirements.
2. **Feedback**: Be specific about what works and what doesn't.
3. **Encouragement**: Be positive and encouraging, even for incorrect solutions.
4. **No Spoilers**: Don't give away the full solution - guide the learner to discover it.
5. **Actionable**: Provide specific next steps they can take.

## Evaluation Criteria

- Does the code compile/run without errors?
- Does it handle the required inputs correctly?
- Is the logic sound?
- Are there any edge cases missed?
- Is the code readable and well-structured?

## Scoring Logic (CRITICAL)

**If the solution is CORRECT (meets all requirements):**
- isCorrect: true
- score: 100-150 (100 = meets requirements, 101-150 = excellence in code quality, performance, edge cases)

**If the solution is INCORRECT (doesn't meet requirements):**
- isCorrect: false
- score: 0-99 (based on partial completion, effort, approach)

## Response Format (CRITICAL - JSON FIRST)

You MUST format your response EXACTLY like this, with JSON metadata FIRST, then feedback text:

\`\`\`json
{
  "isCorrect": true/false,
  "score": 0-150,
  "strengths": ["strength 1", "strength 2"],
  "improvements": ["improvement 1", "improvement 2"],
  "nextSteps": ["next step 1", "next step 2"]
}
\`\`\`

---FEEDBACK---
[ONE sentence only. Maximum 20 words. Be encouraging but extremely brief. No markdown, no code, no lists. Example: "Great attempt! The logic is solid but check the edge cases."]
---END FEEDBACK---

IMPORTANT: 
- The JSON must come FIRST so we can show the result badge immediately
- If isCorrect is true, score MUST be 100 or higher
- Score above 100 is for exceptional quality (clean code, edge cases, performance, best practices)
- The feedback is just a brief summary - all detail goes in the JSON arrays above!`;

/**
 * Builds the evaluation prompt for a specific challenge and solution.
 *
 * @param challenge - The challenge being evaluated
 * @param files - The workspace files to evaluate
 * @returns Formatted prompt string
 *
 * @example
 * ```typescript
 * buildEvaluationPrompt(challenge, [
 *   { name: 'solution.ts', content: 'export function solution() {}' },
 *   { name: 'utils.ts', content: 'export function helper() {}' },
 * ]);
 * ```
 */
export function buildEvaluationPrompt(
  challenge: ChallengeDef,
  files: WorkspaceFileInput[]
): string {
  let prompt = `Evaluate this ${challenge.language} solution for the following challenge:

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
### Test Cases
${challenge.testCases
  .map((tc, i) => `${i + 1}. Input: ${tc.input} → Expected: ${tc.expectedOutput}${tc.description ? ` (${tc.description})` : ''}`)
  .join('\n')}
`;
  }

  // Multi-file workspace
  prompt += `
## User's Solution (${files.length} file${files.length !== 1 ? 's' : ''})
`;
  for (const file of files) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? challenge.language.toLowerCase();
    prompt += `
### ${file.name}
\`\`\`${ext}
${file.content}
\`\`\`
`;
  }

  prompt += `
## Your Task
Evaluate this solution using the EXACT format from your system instructions:
1. First, output the JSON metadata block (isCorrect, score, strengths, improvements, nextSteps)
2. Then, write the feedback text between ---FEEDBACK--- and ---END FEEDBACK--- markers

The JSON comes first so we can show results immediately. The feedback streams live!`;

  return prompt;
}

/**
 * Parses a raw evaluation response text into a structured result.
 * Useful for streaming scenarios where you receive the full response.
 *
 * @param responseText - Raw response from the AI
 * @returns Parsed evaluation result or null if parsing fails
 */
export function parseEvaluationResponse(responseText: string): EvaluationResult | null {
  const parsed = extractJSON<Partial<EvaluationResult>>(responseText);

  if (!parsed) {
    return null;
  }

  // Extract feedback from the ---FEEDBACK--- section if present
  let feedback = parsed.feedback ?? '';
  const feedbackMatch = responseText.match(/---FEEDBACK---\s*([\s\S]*?)(?:---END FEEDBACK---|$)/);
  if (feedbackMatch && feedbackMatch[1]) {
    feedback = feedbackMatch[1].trim();
  }

  return {
    isCorrect: parsed.isCorrect ?? false,
    feedback: feedback || 'Unable to provide detailed feedback.',
    strengths: parsed.strengths ?? [],
    improvements: parsed.improvements ?? [],
    score: parsed.score,
    nextSteps: parsed.nextSteps,
  };
}

/**
 * Attempts to extract partial metadata from streaming content.
 * Returns the metadata as soon as JSON is complete, before feedback streams.
 *
 * @param streamingContent - Partial response text so far
 * @returns Partial result if JSON is complete, null otherwise
 */
export function parsePartialEvaluation(streamingContent: string): PartialEvaluationResult | null {
  const parsed = extractJSON<Partial<EvaluationResult>>(streamingContent);
  
  if (!parsed || parsed.isCorrect === undefined) {
    return null;
  }

  return {
    isCorrect: parsed.isCorrect,
    score: parsed.score,
    strengths: parsed.strengths ?? [],
    improvements: parsed.improvements ?? [],
    nextSteps: parsed.nextSteps,
  };
}

/**
 * Extracts the streaming feedback text from partial response.
 * Returns text after ---FEEDBACK--- marker as it streams in.
 *
 * @param streamingContent - Partial response text so far
 * @returns Feedback text so far, or empty string if not started
 */
export function extractStreamingFeedback(streamingContent: string): string {
  const marker = '---FEEDBACK---';
  const endMarker = '---END FEEDBACK---';
  
  const startIdx = streamingContent.indexOf(marker);
  if (startIdx === -1) {
    return '';
  }
  
  const afterMarker = streamingContent.slice(startIdx + marker.length);
  const endIdx = afterMarker.indexOf(endMarker);
  
  if (endIdx === -1) {
    // Still streaming - return what we have
    return afterMarker.trim();
  }
  
  // Complete
  return afterMarker.slice(0, endIdx).trim();
}

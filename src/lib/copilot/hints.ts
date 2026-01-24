/**
 * Challenge Hints Module
 *
 * Provides AI-powered hints for coding challenges using the Copilot SDK.
 * Supports multi-turn conversations scoped to a specific challenge.
 *
 * @remarks
 * The hint system is designed to:
 * 1. Guide learners without giving away the full solution
 * 2. Build on previous hints in the conversation
 * 3. Be encouraging and educational
 *
 * @see SPEC-002 for acceptance criteria (AC3.1-AC3.4)
 */

import { createLoggedLightweightCoachSession } from './server';
import { extractJSON } from '@/lib/utils/json-utils';
import type { ChallengeDef, HintResult } from './types';

/**
 * Builds the context string for a hint request.
 *
 * @param challenge - The challenge definition
 * @returns Formatted context string
 */
function buildChallengeContext(challenge: ChallengeDef): string {
  let context = `## Challenge: ${challenge.title}
**Language**: ${challenge.language}
**Difficulty**: ${challenge.difficulty}

### Instructions
${challenge.description}`;

  if (challenge.expectedPatterns && challenge.expectedPatterns.length > 0) {
    context += `

### Key Concepts
${challenge.expectedPatterns.join(', ')}`;
  }

  return context;
}

/**
 * Builds the hint request prompt.
 *
 * @param question - User's question
 * @param currentCode - User's current code
 * @param challengeContext - Pre-built challenge context
 * @returns Formatted prompt string
 */
function buildHintPrompt(
  question: string,
  currentCode: string,
  challengeContext: string
): string {
  return `${challengeContext}

## Current Code
\`\`\`
${currentCode}
\`\`\`

## Learner's Question
${question}

## Your Task
Provide a helpful hint that guides them toward the solution without giving it away.

Return JSON:
{
  "hint": "Your hint text here",
  "isFinalHint": false,
  "concepts": ["concept1", "concept2"],
  "suggestedFollowUp": "Optional: a question they might ask next if still stuck"
}

Return ONLY the JSON.`;
}

/**
 * Parses a hint response from the AI.
 *
 * @param responseText - Raw response text
 * @returns Parsed hint result or default
 */
function parseHintResponse(responseText: string): HintResult {
  const parsed = extractJSON<Partial<HintResult>>(responseText);
  if (parsed) {
    return {
      hint: parsed.hint ?? 'Try breaking down the problem into smaller steps.',
      isFinalHint: parsed.isFinalHint ?? false,
      concepts: parsed.concepts,
      suggestedFollowUp: parsed.suggestedFollowUp,
    };
  }

  // Fallback: use the raw response as the hint if it looks reasonable
  if (responseText.length > 10 && responseText.length < 2000) {
    return {
      hint: responseText,
      isFinalHint: false,
    };
  }

  // Default fallback
  return {
    hint: 'Try breaking down the problem into smaller steps. What does each part need to do?',
    isFinalHint: false,
    concepts: ['problem decomposition'],
  };
}

/**
 * Gets a single hint without maintaining session state.
 *
 * @param challenge - The challenge definition
 * @param question - User's question
 * @param currentCode - User's current code
 * @returns Hint result
 *
 * @example
 * ```typescript
 * const hint = await getHint(
 *   { title: 'Sum Array', description: 'Sum all numbers', language: 'JS', difficulty: 'beginner' },
 *   'How do I add all the numbers?',
 *   'function sum(arr) { }'
 * );
 * ```
 */
export async function getHint(
  challenge: ChallengeDef,
  question: string,
  currentCode: string
): Promise<HintResult> {
  const challengeContext = buildChallengeContext(challenge);
  const prompt = buildHintPrompt(question, currentCode, challengeContext);

  const loggedSession = await createLoggedLightweightCoachSession(
    'Single Hint',
    `Hint for ${challenge.title}`
  );

  try {
    const result = await loggedSession.sendAndWait(prompt);
    return parseHintResponse(result.responseText);
  } finally {
    loggedSession.destroy();
  }
}

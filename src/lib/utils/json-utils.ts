/**
 * JSON Utilities
 * 
 * Safe JSON extraction from AI responses.
 * 
 * @module json-utils
 */

import { logger } from '@/lib/logger';

const log = logger.withTag('JSONUtils');

/**
 * Extract JSON from AI response that may contain markdown code blocks.
 * 
 * Handles multiple formats:
 * - JSON wrapped in ```json code blocks
 * - JSON wrapped in ``` code blocks
 * - Raw JSON with nested braces
 * - Direct JSON parsing
 * 
 * SINGLE SOURCE OF TRUTH for AI response parsing.
 * Used across: focus generation, chat, evaluation, hints, README generation.
 * 
 * @template T - Expected type of parsed JSON
 * @param text - Raw AI response text
 * @param context - Optional context for logging
 * @returns Parsed JSON object or null if extraction fails
 * 
 * @example
 * ```typescript
 * const data = extractJSON<MyType>(response);
 * if (data) {
 *   // Use typed data
 * }
 * 
 * // With logging context
 * const challenge = extractJSON<DailyChallenge>(aiResponse, 'Focus Generation');
 * ```
 */
export function extractJSON<T>(text: string, context?: string): T | null {
  if (!text || text.length === 0) {
    if (context) {
      log.debug(`Empty text in ${context}`);
    }
    return null;
  }

  // Strategy 1: Try to extract from ```json blocks
  const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim()) as T;
    } catch (error) {
      if (context) {
        log.debug(`Failed to parse json code block in ${context}:`, error);
      }
      // Continue to other strategies
    }
  }

  // Strategy 2: Try generic code blocks (might be JSON without language tag)
  const codeBlockMatch = text.match(/```\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const blockContent = codeBlockMatch[1].trim();
    if (blockContent.startsWith('{') || blockContent.startsWith('[')) {
      try {
        return JSON.parse(blockContent) as T;
      } catch (error) {
        if (context) {
          log.debug(`Failed to parse generic code block in ${context}:`, error);
        }
        // Continue to other strategies
      }
    }
  }

  // Strategy 3: Find JSON object with brace counting (handles nested objects)
  const firstBrace = text.indexOf('{');
  if (firstBrace !== -1) {
    let braceCount = 0;
    let jsonEnd = -1;
    
    for (let i = firstBrace; i < text.length; i++) {
      if (text[i] === '{') braceCount++;
      if (text[i] === '}') braceCount--;
      if (braceCount === 0) {
        jsonEnd = i;
        break;
      }
    }
    
    if (jsonEnd !== -1) {
      const potentialJson = text.substring(firstBrace, jsonEnd + 1);
      try {
        return JSON.parse(potentialJson) as T;
      } catch (error) {
        if (context) {
          log.debug(`Failed to parse extracted object in ${context}:`, error);
        }
        // Continue to other strategies
      }
    }
  }

  // Strategy 4: Find JSON array with bracket counting
  const firstBracket = text.indexOf('[');
  if (firstBracket !== -1) {
    let bracketCount = 0;
    let jsonEnd = -1;
    
    for (let i = firstBracket; i < text.length; i++) {
      if (text[i] === '[') bracketCount++;
      if (text[i] === ']') bracketCount--;
      if (bracketCount === 0) {
        jsonEnd = i;
        break;
      }
    }
    
    if (jsonEnd !== -1) {
      const potentialJson = text.substring(firstBracket, jsonEnd + 1);
      try {
        return JSON.parse(potentialJson) as T;
      } catch (error) {
        if (context) {
          log.debug(`Failed to parse extracted array in ${context}:`, error);
        }
        // Continue to final strategy
      }
    }
  }

  // Strategy 5: Try direct parse (maybe it's already valid JSON)
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    if (context) {
      log.warn(`All JSON extraction strategies failed in ${context}`, error);
    }
    return null;
  }
}

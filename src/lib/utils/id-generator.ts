/**
 * ID Generation Utilities
 * 
 * Centralized unique ID generation to prevent duplication across the codebase.
 * Uses timestamp + random suffix for guaranteed uniqueness.
 * 
 * @example
 * ```typescript
 * const messageId = generateId('msg');
 * const threadId = generateId('thread');
 * ```
 */

import { nowMs } from '@/lib/utils/date-utils';

/**
 * Generate a unique ID with an optional prefix.
 * 
 * Format: `{prefix}-{timestamp}-{random}`
 * - timestamp: milliseconds since epoch (ensures time-based uniqueness)
 * - random: base36 string (ensures collision resistance)
 * 
 * @param prefix - Optional prefix for the ID (default: 'id')
 * @returns A unique ID string
 */
export function generateId(prefix: string = 'id'): string {
  return `${prefix}-${nowMs()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Generate a message ID (for chat messages, hints, etc.)
 */
export function generateMessageId(): string {
  return generateId('msg');
}

/**
 * Generate a hint ID (for sandbox hints)
 */
export function generateHintId(): string {
  return generateId('hint');
}

/**
 * Challenge Authoring Types
 *
 * Type definitions for the challenge authoring API and session.
 */

import type { DailyChallenge } from '@/lib/focus/types';

/**
 * Context provided by the user during challenge authoring.
 */
export interface AuthoringContext {
  /** Preferred programming language */
  language?: string;
  /** Desired difficulty level */
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  /** Template name if using quick templates */
  template?: string;
  /** Any additional skills to focus on */
  focusSkills?: string[];
}

/**
 * Authoring session configuration.
 */
export interface AuthoringSessionConfig {
  /** User's message */
  prompt: string;
  /** Existing conversation ID for multi-turn */
  conversationId?: string;
  /** User-provided context */
  context?: AuthoringContext;
  /** Action type */
  action?: 'clarify' | 'generate' | 'validate';
}

/**
 * Streaming event types for authoring.
 */
export type AuthoringStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'challenge'; challenge: DailyChallenge }
  | { type: 'validation'; isValid: boolean; issues: string[] }
  | { type: 'done'; totalContent: string; toolCalls: unknown[] }
  | { type: 'error'; message: string };

/**
 * Result from authoring streaming session.
 */
export interface AuthoringStreamingSession {
  /** Async iterator for stream events */
  stream: AsyncGenerator<AuthoringStreamEvent, void, unknown>;
  /** Cleanup function */
  cleanup: () => void;
  /** Model used */
  model: string;
  /** Conversation ID (new or existing) */
  newConversationId: string;
  /** Streaming metrics */
  streamingMetrics: {
    firstDeltaMs: number | null;
    activityEventId?: string;
  };
}

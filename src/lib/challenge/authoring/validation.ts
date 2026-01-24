/**
 * Validation helpers for challenge authoring requests.
 */

import type { AuthoringContext } from './types';

const DIFFICULTY_VALUES = ['beginner', 'intermediate', 'advanced'] as const;
const ACTION_VALUES = ['clarify', 'generate', 'validate'] as const;

/**
 * Validates the authoring request body.
 */
export function validateAuthoringRequest(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return 'Request body is required';
  }

  const req = body as Record<string, unknown>;

  if (!req.prompt || typeof req.prompt !== 'string') {
    return 'prompt is required and must be a string';
  }

  if (req.prompt.length > 10000) {
    return 'prompt exceeds maximum length (10000 characters)';
  }

  if (req.prompt.length < 3) {
    return 'prompt must be at least 3 characters';
  }

  if (req.conversationId !== undefined && req.conversationId !== null && typeof req.conversationId !== 'string') {
    return 'conversationId must be a string';
  }

  if (req.action !== undefined) {
    if (!ACTION_VALUES.includes(req.action as (typeof ACTION_VALUES)[number])) {
      return 'action must be one of: clarify, generate, validate';
    }
  }

  if (req.context !== undefined) {
    if (typeof req.context !== 'object') {
      return 'context must be an object';
    }

    const ctx = req.context as AuthoringContext;

    if (ctx.language !== undefined && typeof ctx.language !== 'string') {
      return 'context.language must be a string';
    }

    if (ctx.difficulty !== undefined) {
      if (!DIFFICULTY_VALUES.includes(ctx.difficulty)) {
        return 'context.difficulty must be beginner, intermediate, or advanced';
      }
    }

    if (ctx.template !== undefined && typeof ctx.template !== 'string') {
      return 'context.template must be a string';
    }
  }

  return null;
}

/**
 * Copilot API Request Types and Validation
 *
 * Shared request shapes and validation helpers for Copilot API routes.
 */

import { validateObject, validateRequiredString } from '@/lib/api';
import type { ChatProfileId } from '@/lib/copilot/profiles';

export interface CopilotChatRequest {
  prompt: string;
  profile: ChatProfileId;
  conversationId?: string;
}

const VALID_PROFILES: readonly ChatProfileId[] = [
  'chat',
  'chat-github',
  'learning',
  'learning-github',
  'evaluation',
  'coach',
  'coach-lightweight',
  'authoring',
];

/**
 * Validates the request body for Copilot chat.
 *
 * @param body - The parsed request body
 * @returns Error message if invalid, null if valid
 */
export function validateCopilotChatRequest(body: unknown): string | null {
  const bodyError = validateObject(body, 'Request body');
  if (bodyError) {
    return bodyError;
  }

  const req = body as Record<string, unknown>;
  const promptError = validateRequiredString(req.prompt, 'prompt');
  if (promptError) return promptError;

  if (typeof req.profile !== 'string' || !VALID_PROFILES.includes(req.profile as ChatProfileId)) {
    return 'profile must be a valid chat profile';
  }
  return null;
}

/**
 * Copilot API Request Types and Validation
 *
 * Shared request shapes and validation helpers for Copilot API routes.
 */

import { validateObject, validateRequiredString } from '@/lib/api';

export interface CopilotChatRequest {
  prompt: string;
  useGitHubTools?: boolean;
  conversationId?: string;
}

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
  return validateRequiredString(req.prompt, 'prompt');
}

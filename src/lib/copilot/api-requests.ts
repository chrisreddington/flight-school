/**
 * Copilot API Request Types and Validation
 *
 * Shared request shapes and validation helpers for Copilot API routes.
 * Pure module — no SDK imports — safe to import from Web/API routes.
 */

import { validateObject, validateRequiredString } from '@/lib/api';
import {
  areCapabilitiesAllowedForProfile,
  isCapabilitiesArg,
  isChatResponseProfile,
  type ChatResponseProfileId,
  type CapabilitiesArg,
} from '@/lib/copilot/profile-types';

export interface CopilotChatRequest {
  prompt: string;
  profile: ChatResponseProfileId;
  /**
   * Caller-supplied capability selection. Worker resolves this against
   * the profile's allowed list and defaults. Omitted = profile defaults.
   */
  capabilities?: CapabilitiesArg;
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
  const promptError = validateRequiredString(req.prompt, 'prompt');
  if (promptError) return promptError;

  if (!isChatResponseProfile(req.profile)) {
    return 'profile must be a chat-response profile (chat | learning)';
  }
  if (req.capabilities !== undefined && !isCapabilitiesArg(req.capabilities)) {
    return "capabilities must be 'auto' or an array of valid capability ids";
  }
  if (!areCapabilitiesAllowedForProfile(req.profile, req.capabilities as CapabilitiesArg | undefined)) {
    return `one or more capabilities are not allowed by profile '${req.profile}'`;
  }
  return null;
}

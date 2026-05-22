/**
 * Public-facing DTO mapper for {@link AIActivityEvent}.
 *
 * The internal `activityLogger` buffer holds the raw assistant
 * response (`output.fullResponse`) and MCP tool call args/results that
 * may contain user-supplied repository content. The REST endpoint
 * (`/api/ai-activity`) and the SSE stream (`/api/ai-activity/stream`)
 * both route through this serializer so neither path leaks unredacted
 * content to the browser.
 *
 * The dev-only `?include=full` query parameter unlocks the full
 * response field, but is gated server-side by
 * `process.env.NODE_ENV === 'development'`.
 *
 * @module copilot/activity/dto
 */

import 'server-only';
import type { AIActivityEvent, AIActivityOutput } from './types';

/** Truncate a string to N chars, appending an ellipsis when clipped. */
function clamp(input: string | undefined, maxChars: number): string | undefined {
  if (typeof input !== 'string') return undefined;
  if (input.length <= maxChars) return input;
  return input.slice(0, maxChars) + '…';
}

/**
 * Sanitize the `output` field for public DTOs.
 *  - `text` is truncated to a hard ceiling so even our own "truncated"
 *    field can't be used to exfiltrate a full response.
 *  - `fullResponse` is dropped unless `includeFull` is set (dev only).
 *  - `toolResult` is dropped (may contain repository content).
 *  - Stable shape fields (`embedding`, `tokens`, `toolsUsed`) pass through.
 */
function redactOutput(
  output: AIActivityOutput | undefined,
  includeFull: boolean,
): AIActivityOutput | undefined {
  if (!output) return undefined;
  return {
    text: clamp(output.text, 500),
    fullResponse: includeFull ? output.fullResponse : undefined,
    embedding: output.embedding,
    tokens: output.tokens,
    toolsUsed: output.toolsUsed,
  };
}

interface PublicMetadata {
  toolName?: string;
}

/**
 * Drop arbitrary metadata; keep only well-known structural fields.
 * MCP tool argument blobs live in `metadata` today and can contain
 * repository names, file paths, code snippets, etc.
 */
function redactMetadata(input: AIActivityEvent['input']): AIActivityEvent['input'] {
  if (!input) return undefined;
  const safeMetadata: PublicMetadata | undefined = input.metadata
    ? { toolName: typeof input.metadata.toolName === 'string' ? input.metadata.toolName : undefined }
    : undefined;
  return {
    prompt: clamp(input.prompt, 200),
    text: clamp(input.text, 200),
    toolName: input.toolName,
    sessionId: input.sessionId,
    model: input.model,
    sessionMetrics: input.sessionMetrics,
    clientMetrics: input.clientMetrics,
    serverMetrics: input.serverMetrics,
    metadata: safeMetadata as Record<string, unknown> | undefined,
  };
}

/**
 * Public DTO with the same shape as {@link AIActivityEvent} but with
 * all raw conversation content stripped/truncated. `userId` is dropped
 * since each event is only ever served to its owner anyway.
 */
export function toPublicActivityEvent(
  event: AIActivityEvent,
  options: { includeFull?: boolean } = {},
): Omit<AIActivityEvent, 'userId'> {
  const allowFull = options.includeFull === true && process.env.NODE_ENV === 'development';
  return {
    id: event.id,
    timestamp: event.timestamp,
    type: event.type,
    operation: event.operation,
    input: redactMetadata(event.input),
    output: redactOutput(event.output, allowFull),
    latencyMs: event.latencyMs,
    status: event.status,
    error: clamp(event.error, 300),
  };
}

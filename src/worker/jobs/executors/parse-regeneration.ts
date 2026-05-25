/**
 * Parse an AI response that should contain a single nested entity (for example
 * `{ challenge: ... }`), throwing a diagnostic error when extraction fails.
 *
 * Regeneration jobs share this shape: a coach session is told to reply with
 * `{ "<kind>": { ... } }`, and the executor materialises the inner object.
 * When the AI breaks the contract (returns prose, wraps the wrong key, etc.)
 * we need to know what came back — without the preview the failure is
 * invisible in logs.
 *
 * @module worker/jobs/executors/parse-regeneration
 */

import { extractJSON } from '@/lib/utils/json-utils';

/** Maximum preview length included in error messages — keeps logs readable. */
const PREVIEW_MAX_CHARS = 400;

/**
 * Extract `wrapperKey` from the JSON inside `responseText`. Throws with a
 * truncated preview of the original response when extraction or validation
 * fails so operators can diagnose why the AI broke the contract.
 *
 * @param responseText - Raw assistant response from the SDK.
 * @param wrapperKey - The required top-level field (`'challenge'`, `'goal'`, …).
 * @param kind - Used in both the JSON-extraction log context and the error.
 */
export function parseRegenerationResponse<TWrapper, TEntity>(
  responseText: string,
  wrapperKey: keyof TWrapper,
  kind: 'topic' | 'challenge' | 'goal',
): TEntity {
  const parsed = extractJSON<TWrapper>(responseText, `${kind}-regeneration`);
  const entity = parsed ? (parsed[wrapperKey] as TEntity | undefined) : undefined;
  if (!entity) {
    const preview =
      responseText.length > PREVIEW_MAX_CHARS ? `${responseText.slice(0, PREVIEW_MAX_CHARS)}…` : responseText;
    throw new Error(`Failed to parse ${kind} response (preview: ${preview})`);
  }
  return entity;
}

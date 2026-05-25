/**
 * Session-cache fingerprint primitives.
 *
 * Kept in its own module so `profiles.ts` stays focused on profile
 * resolution and so the cache contract (capability surface + composed
 * system message hash) has a single, callable home for any future
 * caller that bypasses `resolveProfile`.
 */

import { createHash } from 'node:crypto';

import type { CapabilitySelection } from './capabilities';

/**
 * Stable, order-independent fingerprint of a capability selection set.
 * Two profiles that resolve to the same set share the same fingerprint
 * and therefore share a session cache entry.
 *
 * Tool overrides AND addendum overrides are folded in: two profiles
 * sharing the github capability but with different tool allowlists or
 * different effective addenda are NOT interchangeable for cache reuse.
 */
export function capabilityFingerprintOf(selections: readonly CapabilitySelection[]): string {
  if (selections.length === 0) return 'caps=none';
  const parts = [...selections]
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((selection) => {
      const tail: string[] = [];
      if (selection.tools && selection.tools.length > 0) {
        tail.push(`tools=${[...selection.tools].sort().join(',')}`);
      }
      if (selection.promptAddendumOverride !== undefined) {
        tail.push(`addH=${shortHash(selection.promptAddendumOverride)}`);
      }
      return tail.length === 0 ? selection.id : `${selection.id}@${tail.join('|')}`;
    });
  return `caps=${parts.join('+')}`;
}

/**
 * Compose the full cache-key fingerprint: capability surface PLUS a
 * hash of the composed system message. Callers that bypass
 * `resolveProfile` (e.g. authoring sessions with a dynamic
 * `systemMessage`) MUST use this helper so cached sessions for the
 * same `{user, profile, conversationId}` do not silently serve a
 * different effective system prompt.
 */
export function composeCapabilityFingerprint(
  selections: readonly CapabilitySelection[],
  systemMessage: string,
): string {
  return `${capabilityFingerprintOf(selections)};sys=${shortHash(systemMessage)}`;
}

// SHA-256 truncated to 16 hex chars (64 bits). Birthday-collision
// surface is ~4 billion entries at p=0.5; the per-process cache holds
// at most CHAT_SESSION_MAX (50). Stronger than djb2's 32 bits at
// negligible cost, and removes the codex-panel correctness flag.
function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

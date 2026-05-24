/**
 * Per-conversation capability memory.
 *
 * The session cache is keyed on the **fingerprint of the capability set**,
 * so a turn that elevates GitHub mid-conversation must land on a different
 * cache bucket than the turn that came before it. To keep that change
 * monotonic — once a conversation owns a capability it never gives it
 * back — every successful resolve unions its capability ids into this
 * secondary map and every subsequent resolve folds the result back in as
 * `conversationCapabilities`.
 *
 * The map is sized strictly larger than the session cache so it never
 * evicts a conversation before the session pool itself does (would
 * silently break the monotonic invariant on the next turn).
 */

import type { CapabilityId } from './capability-ids';

interface CachedConversationCaps {
  capabilityIds: readonly CapabilityId[];
  lastUsed: number;
}

/** Same TTL the session pool uses; kept in sync deliberately. */
const CONVERSATION_CAPS_TTL_MS = 30 * 60 * 1000;

/**
 * Max entries; must be ≥ the session pool size so the secondary map
 * never expires the row that a still-cached session is keyed off of.
 * The current session pool caps at 50, so 200 keeps four turns of
 * headroom for late-arriving cancels.
 */
const CONVERSATION_CAPS_MAX = 200;

const globalForConversationCaps = globalThis as typeof globalThis & {
  __chatConversationCapsCache?: Map<string, CachedConversationCaps>;
};

const conversationCapsCache =
  globalForConversationCaps.__chatConversationCapsCache
  ?? new Map<string, CachedConversationCaps>();
if (!globalForConversationCaps.__chatConversationCapsCache) {
  globalForConversationCaps.__chatConversationCapsCache = conversationCapsCache;
}

function conversationCapsKey(userId: string, conversationId: string): string {
  return `${userId}:${conversationId}`;
}

function pruneConversationCaps(): void {
  const now = Date.now();
  for (const [key, entry] of conversationCapsCache.entries()) {
    if (now - entry.lastUsed > CONVERSATION_CAPS_TTL_MS) {
      conversationCapsCache.delete(key);
    }
  }
  if (conversationCapsCache.size <= CONVERSATION_CAPS_MAX) return;
  const sorted = [...conversationCapsCache.entries()].sort(
    (a, b) => a[1].lastUsed - b[1].lastUsed,
  );
  const overflow = sorted.slice(0, conversationCapsCache.size - CONVERSATION_CAPS_MAX);
  for (const [key] of overflow) {
    conversationCapsCache.delete(key);
  }
}

/**
 * Capability ids attached to this conversation so far. Returns `[]`
 * when nothing is recorded (first turn, or evicted).
 */
export function getConversationCapabilities(
  userId: string,
  conversationId: string | undefined,
): readonly CapabilityId[] {
  if (!conversationId) return [];
  const entry = conversationCapsCache.get(conversationCapsKey(userId, conversationId));
  if (!entry) return [];
  return entry.capabilityIds;
}

/**
 * Record (or extend) the capability set attached to a conversation.
 * Always takes the union with the existing set — the conversation
 * capability set is monotonic-add for the lifetime of the
 * conversation.
 */
export function rememberConversationCapabilities(
  userId: string,
  conversationId: string,
  capabilityIds: readonly CapabilityId[],
): void {
  const key = conversationCapsKey(userId, conversationId);
  const existing = conversationCapsCache.get(key);
  const merged = new Set<CapabilityId>([...(existing?.capabilityIds ?? []), ...capabilityIds]);
  conversationCapsCache.set(key, {
    capabilityIds: [...merged].sort() as readonly CapabilityId[],
    lastUsed: Date.now(),
  });
  pruneConversationCaps();
}

/**
 * Test helper: clear the process-global conversation capability cache.
 *
 * The production cache lives at `globalThis.__chatConversationCapsCache`
 * (see `src/lib/copilot/conversation-capabilities.ts`). Tests need a
 * way to reset it between cases without coupling to the module-private
 * Map symbol. Centralising the reach-through here keeps the global key
 * name in one place.
 */
export function clearConversationCapsCache(): void {
  (globalThis as { __chatConversationCapsCache?: Map<string, unknown> }).__chatConversationCapsCache?.clear();
}

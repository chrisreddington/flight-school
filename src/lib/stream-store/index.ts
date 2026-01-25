/**
 * Stream Store
 *
 * Global store for managing AI streams independently of React component lifecycle.
 * Streams persist across navigation - components subscribe to updates.
 *
 * @example
 * ```typescript
 * import { streamStore } from '@/lib/stream-store';
 *
 * // Start a chat stream
 * await streamStore.startStream({
 *   type: 'copilot',
 *   prompt: 'Hello',
 *   conversationId: 'thread-123',
 * });
 *
 * // Subscribe to updates
 * const unsubscribe = streamStore.subscribe('thread-123', (state) => {
 *   console.log(state.content);
 * });
 *
 * // Stop when needed
 * streamStore.stopStream('thread-123');
 * ```
 */

export { streamStore } from './store';
export type { StreamState } from './types';

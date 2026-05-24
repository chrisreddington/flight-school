/**
 * Legacy `▊` cursor stripper for thread payloads.
 *
 * Phase 5 of the streaming refactor removed the worker's mid-stream
 * `▊` cursor glyph. Threads persisted by an older worker may still
 * carry the glyph; reads of those threads must normalise it so the
 * UI doesn't render stale stream artefacts.
 *
 * The helper preserves object identity when no cleanup is required so
 * `React.memo` and shallow equality checks downstream remain effective.
 *
 * @module threads/legacy-cursor
 */

import type { Message, Thread } from './types';

const LEGACY_CURSOR_GLYPH = '▊';

function stripGlyph(content: string): string {
  if (!content.includes(LEGACY_CURSOR_GLYPH)) return content;
  return content.replace(/ ▊| ?▊/g, '').trimEnd();
}

/**
 * Return `thread` with the legacy `▊` cursor glyph stripped from
 * every assistant message. When no cleanup is needed the input thread
 * reference is returned unchanged.
 */
export function stripLegacyCursorFromThread(thread: Thread): Thread {
  let mutated = false;
  const nextMessages: Message[] = thread.messages.map((msg) => {
    if (msg.role !== 'assistant') return msg;
    if (!msg.content.includes(LEGACY_CURSOR_GLYPH)) return msg;
    mutated = true;
    return { ...msg, content: stripGlyph(msg.content) };
  });
  if (!mutated) return thread;
  return { ...thread, messages: nextMessages };
}

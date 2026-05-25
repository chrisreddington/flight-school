/**
 * Tests for {@link stripLegacyCursorFromThread}.
 *
 * The helper normalises threads that may have been persisted with the
 * `▊` cursor glyph by an older worker. Identity preservation is
 * asserted so downstream `React.memo` callers can rely on reference
 * stability.
 */

import { describe, expect, it } from 'vitest';
import type { Thread } from './types';
import { stripLegacyCursorFromThread } from './legacy-cursor';

function mkThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 't1',
    title: 'Thread',
    messages: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    isStreaming: false,
    ...overrides,
  };
}

describe('stripLegacyCursorFromThread', () => {
  it('preserves identity when no glyph is present', () => {
    const thread = mkThread({
      messages: [
        { id: 'u1', role: 'user', content: 'hello', timestamp: 'x' },
        { id: 'a1', role: 'assistant', content: 'hi there', timestamp: 'x' },
      ],
    });
    const result = stripLegacyCursorFromThread(thread);
    expect(result).toBe(thread);
  });

  it('strips trailing ▊ on assistant messages', () => {
    const thread = mkThread({
      messages: [{ id: 'a1', role: 'assistant', content: 'Partial ▊', timestamp: 'x' }],
    });
    const result = stripLegacyCursorFromThread(thread);
    expect(result).not.toBe(thread);
    expect(result.messages[0].content).toBe('Partial');
  });

  it('does not touch user messages even if they contain ▊ (defensive)', () => {
    const thread = mkThread({
      messages: [
        { id: 'u1', role: 'user', content: 'left ▊ alone', timestamp: 'x' },
        { id: 'a1', role: 'assistant', content: 'clean', timestamp: 'x' },
      ],
    });
    const result = stripLegacyCursorFromThread(thread);
    expect(result).toBe(thread);
    expect(result.messages[0].content).toBe('left ▊ alone');
  });

  it('handles multiple assistant messages with mixed state', () => {
    const thread = mkThread({
      messages: [
        { id: 'a1', role: 'assistant', content: 'done', timestamp: 'x' },
        { id: 'a2', role: 'assistant', content: 'mid stream ▊', timestamp: 'x' },
      ],
    });
    const result = stripLegacyCursorFromThread(thread);
    expect(result).not.toBe(thread);
    expect(result.messages[0]).toBe(thread.messages[0]);
    expect(result.messages[1].content).toBe('mid stream');
  });
});

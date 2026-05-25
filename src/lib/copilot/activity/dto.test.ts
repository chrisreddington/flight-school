/**
 * Tests for {@link toPublicActivityEvent}.
 *
 * The activity buffer holds full assistant responses plus any tool
 * args/results the SDK surfaces in `input.metadata`. Both the REST
 * endpoint and the SSE stream route every event through this
 * serializer; if it ever stops redacting, the chat history is one
 * `curl` away from the browser.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toPublicActivityEvent } from './dto';
import type { AIActivityEvent } from './types';

function mkEvent(overrides: Partial<AIActivityEvent> = {}): AIActivityEvent {
  return {
    id: 'evt-1',
    userId: 'u-1',
    timestamp: new Date('2024-01-01T00:00:00.000Z'),
    type: 'chat',
    operation: 'copilot.session.send',
    latencyMs: 100,
    status: 'success',
    ...overrides,
  };
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  process.env.NODE_ENV = 'production';
});

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('toPublicActivityEvent', () => {
  it('drops fullResponse by default', () => {
    const dto = toPublicActivityEvent(
      mkEvent({
        output: { text: 'short text', fullResponse: 'the entire long response body here' },
      }),
    );

    expect(dto.output?.text).toBe('short text');
    expect(dto.output?.fullResponse).toBeUndefined();
  });

  it('truncates output.text to a hard ceiling', () => {
    const dto = toPublicActivityEvent(mkEvent({ output: { text: 'x'.repeat(2000) } }));
    expect(dto.output?.text!.length).toBeLessThanOrEqual(501); // 500 + ellipsis
  });

  it('strips arbitrary input.metadata fields', () => {
    const dto = toPublicActivityEvent(
      mkEvent({
        input: {
          prompt: 'a question',
          metadata: { toolName: 'github', secretArgs: { token: 'gh_xxx' } },
        },
      }),
    );

    expect(dto.input?.metadata).toEqual({ toolName: 'github' });
    expect(dto.input?.metadata).not.toHaveProperty('secretArgs');
  });

  it('omits userId from the DTO', () => {
    const dto = toPublicActivityEvent(mkEvent());
    expect(dto).not.toHaveProperty('userId');
  });

  it('ignores includeFull outside NODE_ENV=development', () => {
    process.env.NODE_ENV = 'production';
    const dto = toPublicActivityEvent(mkEvent({ output: { fullResponse: 'secret' } }), {
      includeFull: true,
    });
    expect(dto.output?.fullResponse).toBeUndefined();
  });

  it('allows fullResponse only when includeFull AND NODE_ENV=development', () => {
    process.env.NODE_ENV = 'development';
    const dto = toPublicActivityEvent(mkEvent({ output: { fullResponse: 'visible-in-dev' } }), {
      includeFull: true,
    });
    expect(dto.output?.fullResponse).toBe('visible-in-dev');
  });
});

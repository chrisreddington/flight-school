import { describe, expect, it } from 'vitest';

import {
  encodeClientTriggerHeaders,
  parseClientTriggerFromHeaders,
  toClientTriggerSpanAttributes,
} from './trigger-metadata';

describe('trigger metadata', () => {
  it('encodes and decodes trigger metadata via headers', () => {
    const headers = encodeClientTriggerHeaders({
      source: 'learning-chat',
      action: 'send-message',
      pagePath: '/history',
      navigationElapsedMs: 1280,
      targetType: 'thread',
      targetId: 'thread-123',
      correlationId: 'b9e8ad89-c6c4-42ef-ad52-f74f0bec71a6',
    });

    expect(parseClientTriggerFromHeaders(headers)).toEqual({
      source: 'learning-chat',
      action: 'send-message',
      pagePath: '/history',
      navigationElapsedMs: 1280,
      targetType: 'thread',
      targetId: 'thread-123',
      correlationId: 'b9e8ad89-c6c4-42ef-ad52-f74f0bec71a6',
    });
  });

  it('drops invalid metadata instead of returning malformed values', () => {
    const parsed = parseClientTriggerFromHeaders({
      'x-flight-school-trigger-source': 'learning-chat',
      'x-flight-school-trigger-action': 'send-message',
      'x-flight-school-trigger-correlation-id': 'invalid',
    });

    expect(parsed).toBeUndefined();
  });

  it('maps metadata into stable span attributes', () => {
    expect(
      toClientTriggerSpanAttributes({
        source: 'ai-focus',
        action: 'skip-goal',
        pagePath: '/skills',
        navigationElapsedMs: 910,
        targetType: 'goal',
        targetId: 'goal-1',
        correlationId: 'b9e8ad89-c6c4-42ef-ad52-f74f0bec71a6',
      }),
    ).toEqual({
      'app.trigger.source': 'ai-focus',
      'app.trigger.action': 'skip-goal',
      'app.trigger.page_path': '/skills',
      'app.trigger.navigation_elapsed_ms': 910,
      'app.trigger.target_type': 'goal',
      'app.trigger.target_id': 'goal-1',
      'app.trigger.correlation_id': 'b9e8ad89-c6c4-42ef-ad52-f74f0bec71a6',
    });
  });

  it('ignores invalid navigation elapsed values while preserving metadata', () => {
    const parsed = parseClientTriggerFromHeaders({
      'x-flight-school-trigger-source': 'learning-chat',
      'x-flight-school-trigger-action': 'send-message',
      'x-flight-school-trigger-page-path': '/chat',
      'x-flight-school-trigger-navigation-elapsed-ms': 'not-a-number',
      'x-flight-school-trigger-correlation-id': 'b9e8ad89-c6c4-42ef-ad52-f74f0bec71a6',
    });

    expect(parsed).toEqual({
      source: 'learning-chat',
      action: 'send-message',
      pagePath: '/chat',
      correlationId: 'b9e8ad89-c6c4-42ef-ad52-f74f0bec71a6',
    });
  });
});

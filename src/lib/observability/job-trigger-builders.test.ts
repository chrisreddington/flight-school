import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAiFocusSkipTrigger,
  createLearningChatSendTrigger,
} from './job-trigger-builders';

describe('job-trigger-builders', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('includes current page and navigation elapsed time for learning chat sends', () => {
    window.history.pushState({}, '', '/learning/history');
    vi.spyOn(performance, 'now').mockReturnValue(1234);

    const trigger = createLearningChatSendTrigger(
      'thread-123',
      'b9e8ad89-c6c4-42ef-ad52-f74f0bec71a6',
    );

    expect(trigger).toEqual({
      source: 'learning-chat',
      action: 'send-message',
      pagePath: '/learning/history',
      navigationElapsedMs: 1234,
      targetType: 'thread',
      targetId: 'thread-123',
      correlationId: 'b9e8ad89-c6c4-42ef-ad52-f74f0bec71a6',
    });
  });

  it('includes current page and navigation elapsed time for ai-focus skips', () => {
    window.history.pushState({}, '', '/skills');
    vi.spyOn(performance, 'now').mockReturnValue(845);

    const trigger = createAiFocusSkipTrigger('goal', 'goal-1');

    expect(trigger).toEqual({
      source: 'ai-focus',
      action: 'skip-goal',
      pagePath: '/skills',
      navigationElapsedMs: 845,
      targetType: 'goal',
      targetId: 'goal-1',
    });
  });
});

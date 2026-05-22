import { describe, expect, it } from 'vitest';

import { buildOperationState } from './operation-results';
import type { ActiveOperation } from './types';

describe('operation result state', () => {
  it('should build snapshots and active target IDs without changing operation shapes', () => {
    const topic: ActiveOperation = {
      id: 'topic-regeneration:topic-1',
      status: 'in-progress',
      meta: {
        type: 'topic-regeneration',
        targetId: 'topic-1',
        startedAt: '2024-01-01T00:00:00.000Z',
      },
    };
    const completedChallenge: ActiveOperation = {
      id: 'challenge-regeneration:challenge-1',
      status: 'complete',
      meta: {
        type: 'challenge-regeneration',
        targetId: 'challenge-1',
        startedAt: '2024-01-01T00:00:00.000Z',
      },
      result: { challenge: { id: 'new-challenge' } },
    };
    const chat: ActiveOperation = {
      id: 'chat-message:thread-1',
      status: 'in-progress',
      meta: {
        type: 'chat-message',
        targetId: 'thread-1',
        startedAt: '2024-01-01T00:00:00.000Z',
      },
    };

    const state = buildOperationState([
      [topic.id, topic],
      [completedChallenge.id, completedChallenge],
      [chat.id, chat],
    ]);

    expect(state.snapshot.topicRegenerations.get(topic.id)).toBe(topic);
    expect(state.snapshot.challengeRegenerations.get(completedChallenge.id)).toBe(completedChallenge);
    expect(state.snapshot.chatMessages.get(chat.id)).toBe(chat);
    expect(state.activeIds.topics).toEqual(new Set(['topic-1']));
    expect(state.activeIds.challenges).toEqual(new Set());
    expect(state.activeIds.chat).toEqual(new Set(['chat-message:thread-1']));
  });

  it('should derive active IDs from target IDs for regeneration operations', () => {
    const state = buildOperationState([
      [
        'goal-regeneration:goal-1',
        {
          id: 'goal-regeneration:goal-1',
          status: 'in-progress',
          meta: {
            type: 'goal-regeneration',
            targetId: 'goal-1',
            startedAt: '2024-01-01T00:00:00.000Z',
          },
        },
      ],
    ]);

    expect(state.activeIds.goals).toEqual(new Set(['goal-1']));
  });
});

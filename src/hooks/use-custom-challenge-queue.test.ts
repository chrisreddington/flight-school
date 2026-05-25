/**
 * Behavioural test suite for useCustomChallengeQueue.
 *
 * Mocks only the api-client seam below the real challengeQueueStore + focusStore.
 * All assertions are on `result.current` — the hook's observable contract.
 *
 * Scenarios from the previous suite that asserted directly on store mocks or on
 * focusStore.addChallenge wiring have been dropped: those behaviours belong to
 * the challengeQueueStore / focusStore tests, not to this hook's test file.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_CUSTOM_QUEUE_SIZE } from '@/lib/challenge/custom-queue';
import type { DailyChallenge } from '@/lib/focus/types';
import { useCustomChallengeQueue } from './use-custom-challenge-queue';

// -- Fake persistence backend at the system seam -------------------------------

interface QueueState {
  challenges: DailyChallenge[];
  lastUpdated: string;
}

let queueState: QueueState;
let focusState: { history: Record<string, unknown> };

vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(async (url: string) => {
    if (url === '/api/challenges/queue') return queueState;
    if (url === '/api/focus/storage') return focusState;
    return undefined;
  }),
  apiPost: vi.fn(async (url: string, data: unknown) => {
    if (url === '/api/challenges/queue') queueState = data as QueueState;
    if (url === '/api/focus/storage') focusState = data as { history: Record<string, unknown> };
  }),
  apiDelete: vi.fn(async (url: string) => {
    if (url === '/api/challenges/queue') queueState = { challenges: [], lastUpdated: '' };
  }),
}));

// -- Fixtures ------------------------------------------------------------------

const challenge = (id: string, overrides: Partial<DailyChallenge> = {}): DailyChallenge => ({
  id,
  title: `Title ${id}`,
  description: `Description ${id}`,
  difficulty: 'beginner',
  estimatedMinutes: 15,
  category: 'frontend',
  isCustom: true,
  ...overrides,
});

const dailyChallenge: DailyChallenge = {
  id: 'daily-1',
  title: 'Daily',
  description: 'Daily challenge',
  difficulty: 'intermediate',
  estimatedMinutes: 30,
  category: 'backend',
};

function seed(challenges: DailyChallenge[]): void {
  queueState = { challenges, lastUpdated: '' };
  focusState = { history: {} };
}

async function renderLoaded(daily: DailyChallenge | null = null) {
  const view = renderHook((d: DailyChallenge | null) => useCustomChallengeQueue(d), {
    initialProps: daily,
  });
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  return view;
}

beforeEach(() => {
  seed([]);
});

// -- Tests ---------------------------------------------------------------------

describe('useCustomChallengeQueue — initial load', () => {
  it('starts with isLoading=true, then exposes the stored queue', async () => {
    seed([challenge('c1'), challenge('c2')]);
    const { result } = renderHook(() => useCustomChallengeQueue(null));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.queue).toEqual([]);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.queue.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(result.current.queueCount).toBe(2);
  });

  it('exposes maxQueueSize and a non-full queue when below the limit', async () => {
    seed([challenge('c1')]);
    const { result } = await renderLoaded();
    expect(result.current.maxQueueSize).toBe(MAX_CUSTOM_QUEUE_SIZE);
    expect(result.current.isQueueFull).toBe(false);
  });

  it('reports isQueueFull=true once the queue reaches MAX_CUSTOM_QUEUE_SIZE', async () => {
    seed(Array.from({ length: MAX_CUSTOM_QUEUE_SIZE }, (_, i) => challenge(`c${i}`)));
    const { result } = await renderLoaded();
    expect(result.current.isQueueFull).toBe(true);
    expect(result.current.queueCount).toBe(MAX_CUSTOM_QUEUE_SIZE);
  });
});

describe('useCustomChallengeQueue — active challenge priority', () => {
  it.each<[string, DailyChallenge[], DailyChallenge | null, string | null, string, number]>([
    [
      'custom queue takes priority over daily',
      [challenge('c1'), challenge('c2')],
      dailyChallenge,
      'c1',
      'custom-queue',
      2,
    ],
    ['falls back to daily when queue is empty', [], dailyChallenge, 'daily-1', 'daily', 0],
    ['reports source=none when both are missing', [], null, null, 'none', 0],
  ])('%s', async (_label, queue, daily, expectedId, expectedSource, expectedRemaining) => {
    seed(queue);
    const { result } = await renderLoaded(daily);
    expect(result.current.activeChallenge?.id ?? null).toBe(expectedId);
    expect(result.current.activeSource).toBe(expectedSource);
    expect(result.current.queueRemaining).toBe(expectedRemaining);
  });

  it('exposes daily challenge as fallback while still loading', async () => {
    seed([challenge('c1')]);
    const { result } = renderHook(() => useCustomChallengeQueue(dailyChallenge));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.activeChallenge?.id).toBe('daily-1');
    expect(result.current.activeSource).toBe('daily');
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });
});

describe('useCustomChallengeQueue — addChallenge', () => {
  it('appends a new challenge and marks it as custom in the visible queue', async () => {
    const { result } = await renderLoaded();

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.addChallenge(challenge('new', { isCustom: false }));
    });

    expect(outcome).toBe(true);
    expect(result.current.queueCount).toBe(1);
    expect(result.current.queue[0]).toMatchObject({ id: 'new', isCustom: true });
  });

  it('returns false and leaves the queue unchanged when the queue is full', async () => {
    seed(Array.from({ length: MAX_CUSTOM_QUEUE_SIZE }, (_, i) => challenge(`c${i}`)));
    const { result } = await renderLoaded();

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.addChallenge(challenge('overflow'));
    });

    expect(outcome).toBe(false);
    expect(result.current.queueCount).toBe(MAX_CUSTOM_QUEUE_SIZE);
    expect(result.current.queue.find((c) => c.id === 'overflow')).toBeUndefined();
  });
});

describe('useCustomChallengeQueue — removeChallenge', () => {
  it.each<[string, string, boolean, string[]]>([
    ['removes a known challenge and shrinks the queue', 'c1', true, ['c2']],
    ['returns false and leaves the queue intact when id is unknown', 'missing', false, ['c1', 'c2']],
  ])('%s', async (_label, id, expectedOutcome, remainingIds) => {
    seed([challenge('c1'), challenge('c2')]);
    const { result } = await renderLoaded();

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.removeChallenge(id);
    });

    expect(outcome).toBe(expectedOutcome);
    expect(result.current.queue.map((c) => c.id)).toEqual(remainingIds);
  });
});

describe('useCustomChallengeQueue — advanceQueue', () => {
  it('pops the head and exposes the next challenge as active', async () => {
    seed([challenge('c1'), challenge('c2')]);
    const { result } = await renderLoaded(dailyChallenge);
    expect(result.current.activeChallenge?.id).toBe('c1');

    let popped: DailyChallenge | null = null;
    await act(async () => {
      popped = await result.current.advanceQueue();
    });

    expect(popped?.id).toBe('c1');
    expect(result.current.queue.map((c) => c.id)).toEqual(['c2']);
    expect(result.current.activeChallenge?.id).toBe('c2');
  });

  it('returns null when the queue is empty and leaves state unchanged', async () => {
    const { result } = await renderLoaded(dailyChallenge);

    let popped: DailyChallenge | null = challenge('sentinel');
    await act(async () => {
      popped = await result.current.advanceQueue();
    });

    expect(popped).toBeNull();
    expect(result.current.queueCount).toBe(0);
    expect(result.current.activeChallenge?.id).toBe('daily-1');
  });
});

describe('useCustomChallengeQueue — reorderChallenge', () => {
  it('moves a challenge to a new position', async () => {
    seed([challenge('c1'), challenge('c2'), challenge('c3')]);
    const { result } = await renderLoaded();

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.reorderChallenge('c3', 0);
    });

    expect(outcome).toBe(true);
    expect(result.current.queue.map((c) => c.id)).toEqual(['c3', 'c1', 'c2']);
  });

  it('returns false for an invalid index and leaves order unchanged', async () => {
    seed([challenge('c1'), challenge('c2')]);
    const { result } = await renderLoaded();

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.reorderChallenge('c1', 99);
    });

    expect(outcome).toBe(false);
    expect(result.current.queue.map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});

describe('useCustomChallengeQueue — updateChallenge', () => {
  it('applies partial updates while keeping isCustom=true', async () => {
    seed([challenge('c1', { title: 'Original' })]);
    const { result } = await renderLoaded();

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.updateChallenge('c1', {
        title: 'Updated',
        difficulty: 'expert',
      });
    });

    expect(outcome).toBe(true);
    expect(result.current.queue[0]).toMatchObject({
      id: 'c1',
      title: 'Updated',
      difficulty: 'expert',
      isCustom: true,
    });
  });

  it('returns false when the target challenge does not exist', async () => {
    seed([challenge('c1')]);
    const { result } = await renderLoaded();

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.updateChallenge('missing', { title: 'x' });
    });

    expect(outcome).toBe(false);
    expect(result.current.queue[0].title).toBe('Title c1');
  });
});

describe('useCustomChallengeQueue — clearQueue & getById', () => {
  it('clears every challenge from the queue', async () => {
    seed([challenge('c1'), challenge('c2')]);
    const { result } = await renderLoaded(dailyChallenge);

    await act(async () => {
      await result.current.clearQueue();
    });

    expect(result.current.queueCount).toBe(0);
    expect(result.current.activeChallenge?.id).toBe('daily-1');
  });

  it.each<[string, string, string | null]>([
    ['returns the matching challenge by id', 'c2', 'c2'],
    ['returns null for an unknown id', 'missing', null],
  ])('%s', async (_label, id, expectedId) => {
    seed([challenge('c1'), challenge('c2')]);
    const { result } = await renderLoaded();
    const found = await result.current.getById(id);
    expect(found?.id ?? null).toBe(expectedId);
  });
});

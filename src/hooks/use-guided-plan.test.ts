/**
 * useGuidedPlan — behaviour suite. Mocks live at system seams only:
 * `fetch` (the AI plan endpoint) and `localStorage` (the 24h cache). The
 * hook, TanStack Query, and the fallback helper all run for real.
 *
 * @vitest-environment jsdom
 */

import { renderHook, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, type Mock } from 'vitest';

import type { GuidedPlan } from '@/lib/copilot/guided-mode-types';
import { createQueryTestWrapper } from '@/test/query-test-wrapper';

import { useGuidedPlan } from './use-guided-plan';

const fetchMock = global.fetch as unknown as Mock;

// jsdom in this project ships without a `localStorage` implementation, so
// stand up an in-memory Storage stub for the duration of this suite. The
// hook reads/writes via the global `localStorage` reference inside
// `readCache` / `writeCache`.
function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
}

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const stubStorage = createLocalStorageStub();

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: stubStorage,
  });
});

afterAll(() => {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  } else {
    Reflect.deleteProperty(globalThis as object, 'localStorage');
  }
});

const challenge = {
  title: 'Two Sum',
  description: 'Return indices of two numbers that add up to a target.',
  language: 'TypeScript',
  difficulty: 'easy',
};

const aiPlan: GuidedPlan = {
  totalSteps: 1,
  steps: [
    {
      stepNumber: 1,
      title: 'AI step',
      instruction: 'Do the thing',
      scaffoldLevel: 'full',
      elaborationPrompt: 'Why?',
    },
  ],
};

function okJson(body: unknown) {
  return { ok: true, status: 200, headers: new Headers(), json: async () => body };
}

function notOk(status: number) {
  return { ok: false, status, headers: new Headers(), json: async () => ({}) };
}

beforeEach(() => {
  fetchMock.mockReset();
  stubStorage.clear();
});

describe('useGuidedPlan — cache miss path', () => {
  it('fetches the AI plan and persists it to localStorage', async () => {
    fetchMock.mockImplementation(async () => okJson(aiPlan));

    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useGuidedPlan('challenge-1', challenge), { wrapper });

    expect(result.current.loading).toBe(true);
    expect(result.current.plan).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plan).toEqual(aiPlan);

    const stored = stubStorage.getItem('guided-plan:challenge-1');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string) as { plan: GuidedPlan; cachedAt: number };
    expect(parsed.plan).toEqual(aiPlan);
    expect(typeof parsed.cachedAt).toBe('number');
  });
});

describe('useGuidedPlan — cache hit path', () => {
  it('returns the cached plan without touching the API when localStorage is warm', async () => {
    stubStorage.setItem('guided-plan:challenge-1', JSON.stringify({ plan: aiPlan, cachedAt: Date.now() }));

    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useGuidedPlan('challenge-1', challenge), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plan).toEqual(aiPlan);
    // Observable seam: the fetch mock would have populated mock.calls if
    // the queryFn had fallen through to the API.
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  it('treats a >24h cache entry as a miss and re-fetches', async () => {
    const TWENTY_FIVE_HOURS = 25 * 60 * 60 * 1000;
    const freshPlan: GuidedPlan = {
      totalSteps: 2,
      steps: [
        { stepNumber: 1, title: 'Fresh A', instruction: 'A', scaffoldLevel: 'full', elaborationPrompt: '?' },
        { stepNumber: 2, title: 'Fresh B', instruction: 'B', scaffoldLevel: 'goal', elaborationPrompt: '?' },
      ],
    };
    stubStorage.setItem(
      'guided-plan:challenge-1',
      JSON.stringify({ plan: aiPlan, cachedAt: Date.now() - TWENTY_FIVE_HOURS }),
    );
    fetchMock.mockImplementation(async () => okJson(freshPlan));

    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useGuidedPlan('challenge-1', challenge), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    // Observable: the new plan reflects the live response, not the stale
    // localStorage entry — proving the cache was bypassed.
    expect(result.current.plan).toEqual(freshPlan);
  });
});

describe('useGuidedPlan — fallback path', () => {
  it('surfaces the static fallback when the API fails without poisoning the cache', async () => {
    fetchMock.mockImplementation(async () => notOk(500));

    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useGuidedPlan('challenge-1', challenge), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.plan).not.toBeNull();
    expect(result.current.plan?.steps[0]?.title).toContain('Two Sum');

    // Failure must not be written to localStorage — a subsequent mount has
    // to be free to retry the AI request.
    expect(stubStorage.getItem('guided-plan:challenge-1')).toBeNull();
  });
});

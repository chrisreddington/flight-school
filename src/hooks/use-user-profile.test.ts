/**
 * useUserProfile — behaviour suite. Mocks live at the system seam (`fetch`)
 * only: the hook, TanStack Query, and the profile-normalization helpers all
 * run for real so the assertions describe observable hook output, not
 * call-forwarding wiring.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, type Mock } from 'vitest';

import type { ProfileResponse } from '@/app/api/profile/route';
import { createQueryTestWrapper } from '@/test/query-test-wrapper';
import { getDateKey } from '@/lib/utils/date-utils';

import { getDisplayName, useUserProfile } from './use-user-profile';

const fetchMock = global.fetch as unknown as Mock;

function makeProfile(over: Partial<ProfileResponse['user']> = {}): ProfileResponse {
  return {
    user: {
      login: 'testuser',
      name: 'Test User',
      avatarUrl: 'https://avatar.url',
      bio: null,
      company: null,
      location: null,
      totalRepos: 10,
      followers: 5,
      following: 3,
      memberSince: '2020',
      ...over,
    },
    stats: { experienceLevel: 'intermediate', yearsOnGitHub: 3, topLanguages: ['TypeScript'] },
    pastSevenDays: { commits: 12, pullRequests: 3, reposUpdated: 2 },
    repos: [],
    meta: { cached: true, aiEnabled: true, method: 'cache', totalTimeMs: 50, authMethod: 'oauth' },
  };
}

function okJson(body: unknown) {
  return { ok: true, status: 200, headers: new Headers(), json: async () => body };
}

function notOk(status: number) {
  return { ok: false, status, headers: new Headers(), json: async () => ({}) };
}

/**
 * Routes the global fetch mock by URL+method so the hook exercises both
 * the storage cache endpoint and the live profile endpoint via real code
 * paths.
 */
function mountApi(opts: {
  cached?: ProfileResponse | null;
  cachedDate?: string;
  live?: ProfileResponse | (() => Promise<ProfileResponse>);
  liveFails?: boolean;
}) {
  const date = opts.cachedDate ?? getDateKey();
  const liveCalls = { count: 0 };
  fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
    const target = typeof url === 'string' ? url : url.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    if (target.includes('/api/profile/storage')) {
      if (method === 'POST') return okJson({});
      if (!opts.cached) return okJson(null);
      return okJson({ date, profile: opts.cached });
    }

    if (target.includes('/api/profile')) {
      liveCalls.count += 1;
      if (opts.liveFails) return notOk(500);
      const body = typeof opts.live === 'function' ? await opts.live() : opts.live;
      return okJson(body);
    }

    return okJson({});
  });
  return liveCalls;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('useUserProfile — initial load', () => {
  it('starts in loading state then exposes the live profile when no cache exists', async () => {
    const live = makeProfile({ login: 'live-user' });
    const liveCalls = mountApi({ cached: null, live });

    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useUserProfile(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.user.login).toBe('live-user');
    expect(result.current.error).toBeNull();
    expect(liveCalls.count).toBe(1);
  });

  it('serves cached data without hitting the live profile endpoint', async () => {
    const cached = makeProfile({ login: 'cached-user' });
    const liveCalls = mountApi({ cached, live: makeProfile({ login: 'live-user' }) });

    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useUserProfile(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.user.login).toBe('cached-user');
    expect(liveCalls.count).toBe(0);
  });

  it('falls through to live fetch when cache is from a previous day', async () => {
    const liveCalls = mountApi({
      cached: makeProfile({ login: 'stale-user' }),
      cachedDate: '2000-01-01',
      live: makeProfile({ login: 'live-user' }),
    });

    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useUserProfile(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.user.login).toBe('live-user');
    expect(liveCalls.count).toBe(1);
  });

  it('surfaces an error string when the live fetch fails', async () => {
    mountApi({ cached: null, liveFails: true });

    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useUserProfile(), { wrapper });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeNull();
  });
});

describe('useUserProfile — refetch bypass', () => {
  it('skips the cache check on refetch and writes fresh data into the query cache', async () => {
    const cached = makeProfile({ login: 'cached-user' });
    const live = makeProfile({ login: 'fresh-user' });
    const liveCalls = mountApi({ cached, live });

    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useUserProfile(), { wrapper });

    await waitFor(() => expect(result.current.data?.user.login).toBe('cached-user'));
    expect(liveCalls.count).toBe(0);

    await act(async () => {
      await result.current.refetch();
    });

    expect(liveCalls.count).toBe(1);
    expect(result.current.data?.user.login).toBe('fresh-user');
  });

  it('flips isLoading true while a manual refetch is in flight', async () => {
    const cached = makeProfile({ login: 'cached-user' });
    let resolveLive!: (value: ProfileResponse) => void;
    const livePromise = new Promise<ProfileResponse>((resolve) => {
      resolveLive = resolve;
    });
    mountApi({ cached, live: () => livePromise });

    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useUserProfile(), { wrapper });

    await waitFor(() => expect(result.current.data?.user.login).toBe('cached-user'));

    let refetchPromise!: Promise<void>;
    act(() => {
      refetchPromise = result.current.refetch();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(true));

    resolveLive(makeProfile({ login: 'fresh-user' }));
    await act(async () => {
      await refetchPromise;
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data?.user.login).toBe('fresh-user');
  });

  it('preserves previous data, clears loading, and surfaces error when a manual refetch fails', async () => {
    const cached = makeProfile({ login: 'cached-user' });
    mountApi({ cached, liveFails: true });

    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useUserProfile(), { wrapper });

    await waitFor(() => expect(result.current.data?.user.login).toBe('cached-user'));
    expect(result.current.error).toBeNull();

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data?.user.login).toBe('cached-user');
    // Contract: refetch failures surface through `error` so consumers can
    // toast or retry — the imperative refetch must route through TanStack's
    // pipeline rather than swallow errors.
    expect(result.current.error).not.toBeNull();
  });

  it('runs the bypass queryFn even when the initial mount query is still in flight', async () => {
    // Regression: TanStack's fetchQuery dedupes on same key. Without a
    // cancelQueries before the bypass, the manual refetch would await
    // the in-flight initial query (which uses bypassCache: false) and
    // return cached data instead of the fresh /api/profile response.
    const cached = makeProfile({ login: 'cached-user' });
    const fresh = makeProfile({ login: 'fresh-from-bypass' });

    let resolveCacheCheck!: (value: ProfileResponse | null) => void;
    const cacheCheckPromise = new Promise<ProfileResponse | null>((resolve) => {
      resolveCacheCheck = resolve;
    });

    const liveCalls = { count: 0 };
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url.toString();
      const method = (init?.method ?? 'GET').toUpperCase();

      if (target.includes('/api/profile/storage')) {
        if (method === 'POST') return okJson({});
        const value = await cacheCheckPromise;
        if (!value) return okJson(null);
        return okJson({ date: getDateKey(), profile: value });
      }

      if (target.includes('/api/profile')) {
        liveCalls.count += 1;
        return okJson(fresh);
      }

      return okJson({});
    });

    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useUserProfile(), { wrapper });

    // Initial query is in flight (cache-check is pending).
    expect(result.current.isLoading).toBe(true);

    let refetchPromise!: Promise<void>;
    act(() => {
      refetchPromise = result.current.refetch();
    });

    // Unblock the cache check so the initial-query promise resolves —
    // if cancellation hadn't happened, the bypass would now return the
    // cached value via dedupe.
    resolveCacheCheck(cached);

    await act(async () => {
      await refetchPromise;
    });

    // The /api/profile endpoint must have been hit exactly once (the
    // bypass call) — not zero (which would mean cancellation failed and
    // dedupe won) and not more than one (which would mean the bypass
    // fired redundantly).
    expect(liveCalls.count).toBe(1);
    expect(result.current.data?.user.login).toBe('fresh-from-bypass');
  });

  it('keeps isLoading true between divergent refetch settlements', async () => {
    // Regression for the ref-counted guard in `refetch()`. Two rapid
    // refetches settle at DIFFERENT times even though their underlying
    // network fetch is shared:
    //
    //   - Call 2's `cancelQueries` aborts call 1's retryer with
    //     `revert: true`. TanStack's `fetchQuery` catch returns the
    //     reverted `state.data` immediately, so call 1's wrapper promise
    //     resolves on the next microtask.
    //   - Call 2's `fetchQuery` then runs through `apiGet` which dedupes
    //     onto call 1's still-pending /api/profile network promise (see
    //     `src/lib/api-client.ts` `pendingRequests` Map). Call 2's wrapper
    //     promise therefore waits until the shared network promise resolves.
    //
    // Without the ref-counter, call 1's `finally` would flip the indicator
    // to false the moment its wrapper resolved, leaving a visible "loading
    // off → loading on" flash while call 2 is still in flight. With the
    // counter, the indicator stays true until both wrappers settle.
    const initial = makeProfile({ login: 'initial' });
    const fresh = makeProfile({ login: 'fresh' });

    let resolveLive!: (value: ProfileResponse) => void;
    const liveGate = new Promise<ProfileResponse>((resolve) => {
      resolveLive = resolve;
    });

    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url.toString();
      const method = (init?.method ?? 'GET').toUpperCase();

      if (target.includes('/api/profile/storage')) {
        if (method === 'POST') return okJson({});
        return okJson({ date: getDateKey(), profile: initial });
      }

      if (target.includes('/api/profile')) {
        const value = await liveGate;
        return okJson(value);
      }

      return okJson({});
    });

    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useUserProfile(), { wrapper });

    await waitFor(() => expect(result.current.data?.user.login).toBe('initial'));

    // Dispatch call 1 and wait until its bypass fetch is actually awaiting
    // the gate inside the mock. Only then will call 2's `cancelQueries`
    // land on an in-flight retryer and trigger the revert path.
    let firstRefetch!: Promise<void>;
    act(() => {
      firstRefetch = result.current.refetch();
    });
    await waitFor(() => {
      const bypassCalls = fetchMock.mock.calls.filter(
        (call) => String(call[0]).endsWith('/api/profile') && (call[1] as RequestInit | undefined)?.method !== 'POST',
      );
      expect(bypassCalls.length).toBeGreaterThanOrEqual(1);
    });

    // Dispatch call 2 — its `cancelQueries` will revert call 1.
    let secondRefetch!: Promise<void>;
    act(() => {
      secondRefetch = result.current.refetch();
    });

    // Call 1 settles first (revert path resolves to the cached value).
    // Counter goes 2→1; loading must stay true because call 2 is in flight.
    await act(async () => {
      await firstRefetch;
    });
    expect(result.current.isLoading).toBe(true);

    // Release the shared network promise. Call 2 now settles. Counter 1→0.
    resolveLive(fresh);
    await act(async () => {
      await secondRefetch;
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data?.user.login).toBe('fresh');
  });
});

describe('getDisplayName helper', () => {
  it('returns the first name when name is available', () => {
    expect(getDisplayName(makeProfile({ name: 'John Doe' }))).toBe('John');
  });

  it('returns the login when name is null', () => {
    expect(getDisplayName(makeProfile({ login: 'cooldev', name: null }))).toBe('cooldev');
  });

  it('returns the login when name is an empty string', () => {
    expect(getDisplayName(makeProfile({ login: 'anotherdev', name: '' }))).toBe('anotherdev');
  });

  it('returns "Developer" when the profile is null', () => {
    expect(getDisplayName(null)).toBe('Developer');
  });

  it('returns "Developer" when profile.user is missing', () => {
    expect(getDisplayName({} as ProfileResponse)).toBe('Developer');
  });

  it('handles single-word names without splitting away from them', () => {
    expect(getDisplayName(makeProfile({ name: 'Madonna' }))).toBe('Madonna');
  });
});

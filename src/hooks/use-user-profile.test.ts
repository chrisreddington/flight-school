/**
 * useUserProfile — behaviour suite. Mocks live at the system seam (`fetch`)
 * only: the hook, TanStack Query, and the profile-normalization helpers all
 * run for real so the assertions describe observable hook output, not
 * call-forwarding wiring.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, type Mock } from 'vitest';

import type { ProfileResponse } from '@/app/api/profile/route';
import { createQueryTestWrapper } from '@/test/query-test-wrapper';

import { getDisplayName, useUserProfile } from './use-user-profile';

const fetchMock = global.fetch as unknown as Mock;

/**
 * Wrapper bound to a caller-supplied QueryClient so a single client (with a
 * non-zero gcTime) can survive an unmount and be reused across remounts —
 * needed to exercise the in-memory-cache revalidation path.
 */
function persistentClientWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

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
    meta: { cached: true, aiEnabled: true, method: 'cache', totalTimeMs: 50, authMethod: 'github-oauth' },
  };
}

function okJson(body: unknown) {
  return { ok: true, status: 200, headers: new Headers(), json: async () => body };
}

function notOk(status: number) {
  return { ok: false, status, headers: new Headers(), json: async () => ({}) };
}

/**
 * Routes the global fetch mock for `/api/profile`. The hook no longer reads a
 * client-side cache — every load validates the token through `/api/profile` —
 * so the mock only needs to model that endpoint.
 */
function mountApi(opts: { live?: ProfileResponse | (() => Promise<ProfileResponse>); liveFails?: boolean }) {
  const liveCalls = { count: 0 };
  fetchMock.mockImplementation(async (url: string | URL) => {
    const target = typeof url === 'string' ? url : url.toString();

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
  it('starts in loading state then exposes the live profile', async () => {
    const live = makeProfile({ login: 'live-user' });
    const liveCalls = mountApi({ live });

    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useUserProfile(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.user.login).toBe('live-user');
    expect(result.current.error).toBeNull();
    expect(liveCalls.count).toBe(1);
  });

  it('validates through /api/profile on every mount — never serves stale data when re-auth fails', async () => {
    // Regression for the "expired token kept rendering profile data" bug.
    // There is no client-side cache to short-circuit `/api/profile`, so when
    // the live endpoint rejects the session (here a 500; in production a 401
    // that `api-client` turns into a `/sign-in` redirect) the hook surfaces an
    // error and exposes NO data rather than masking the dead session.
    const liveCalls = mountApi({ liveFails: true });

    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useUserProfile(), { wrapper });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(liveCalls.count).toBe(1);
  });

  it('revalidates through /api/profile on remount within the stale window instead of trusting the in-memory cache', async () => {
    // Regression: TanStack Query's QueryClient is the de-facto client cache.
    // Without `staleTime: 0` + `refetchOnMount: 'always'`, a remount inside the
    // stale window would serve the cached `query.data` WITHOUT re-hitting
    // `/api/profile`, so a token revoked mid-session would keep rendering
    // stale data. A long `gcTime` keeps the cache entry alive across the
    // unmount so this test exercises the remount-revalidation path.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 5 * 60_000 } },
    });
    const wrapper = persistentClientWrapper(client);

    let liveCount = 0;
    fetchMock.mockImplementation(async (url: string | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('/api/profile')) {
        liveCount += 1;
        return okJson(makeProfile({ login: `user-${liveCount}` }));
      }
      return okJson({});
    });

    const firstMount = renderHook(() => useUserProfile(), { wrapper });
    await waitFor(() => expect(firstMount.result.current.data?.user.login).toBe('user-1'));
    firstMount.unmount();

    const secondMount = renderHook(() => useUserProfile(), { wrapper });
    // SWR shows last-known-good `user-1` immediately, then the forced
    // background revalidation settles to the fresh `user-2` payload.
    await waitFor(() => expect(secondMount.result.current.data?.user.login).toBe('user-2'));

    // The remount must have issued a SECOND validation rather than serving the
    // cached user-1 data untouched.
    expect(liveCount).toBe(2);
    expect(secondMount.result.current.data?.user.login).toBe('user-2');
  });
});

describe('useUserProfile — refetch', () => {
  it('issues a fresh /api/profile request and writes the result into the query cache', async () => {
    let liveCount = 0;
    const initial = makeProfile({ login: 'initial-user' });
    const fresh = makeProfile({ login: 'fresh-user' });
    fetchMock.mockImplementation(async (url: string | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('/api/profile')) {
        liveCount += 1;
        return okJson(liveCount === 1 ? initial : fresh);
      }
      return okJson({});
    });

    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useUserProfile(), { wrapper });

    await waitFor(() => expect(result.current.data?.user.login).toBe('initial-user'));

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data?.user.login).toBe('fresh-user');
    expect(liveCount).toBeGreaterThanOrEqual(2);
  });

  it('flips isLoading true while a manual refetch is in flight', async () => {
    let liveCount = 0;
    const initial = makeProfile({ login: 'initial-user' });
    let resolveLive!: (value: ProfileResponse) => void;
    const livePromise = new Promise<ProfileResponse>((resolve) => {
      resolveLive = resolve;
    });
    fetchMock.mockImplementation(async (url: string | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('/api/profile')) {
        liveCount += 1;
        return okJson(liveCount === 1 ? initial : await livePromise);
      }
      return okJson({});
    });

    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useUserProfile(), { wrapper });

    await waitFor(() => expect(result.current.data?.user.login).toBe('initial-user'));

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
    let liveCount = 0;
    const initial = makeProfile({ login: 'initial-user' });
    fetchMock.mockImplementation(async (url: string | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('/api/profile')) {
        liveCount += 1;
        return liveCount === 1 ? okJson(initial) : notOk(500);
      }
      return okJson({});
    });

    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useUserProfile(), { wrapper });

    await waitFor(() => expect(result.current.data?.user.login).toBe('initial-user'));
    expect(result.current.error).toBeNull();

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data?.user.login).toBe('initial-user');
    // Contract: refetch failures surface through `error` so consumers can
    // toast or retry — the imperative refetch must route through TanStack's
    // pipeline rather than swallow errors.
    expect(result.current.error).not.toBeNull();
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

    let liveCount = 0;
    let resolveLive!: (value: ProfileResponse) => void;
    const liveGate = new Promise<ProfileResponse>((resolve) => {
      resolveLive = resolve;
    });

    fetchMock.mockImplementation(async (url: string | URL) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('/api/profile')) {
        liveCount += 1;
        // First load resolves immediately so the hook paints `initial`;
        // every later (refetch) request awaits the shared gate.
        return okJson(liveCount === 1 ? initial : await liveGate);
      }
      return okJson({});
    });

    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useUserProfile(), { wrapper });

    await waitFor(() => expect(result.current.data?.user.login).toBe('initial'));

    // Dispatch call 1 and wait until its refetch fetch is actually awaiting
    // the gate inside the mock. Only then will call 2's `cancelQueries`
    // land on an in-flight retryer and trigger the revert path.
    let firstRefetch!: Promise<void>;
    act(() => {
      firstRefetch = result.current.refetch();
    });
    await waitFor(() => expect(liveCount).toBeGreaterThanOrEqual(2));

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

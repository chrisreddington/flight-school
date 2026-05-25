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

  it('preserves previous data and clears loading even when a manual refetch fails', async () => {
    const cached = makeProfile({ login: 'cached-user' });
    mountApi({ cached, liveFails: true });

    const { wrapper } = createQueryTestWrapper();
    const { result } = renderHook(() => useUserProfile(), { wrapper });

    await waitFor(() => expect(result.current.data?.user.login).toBe('cached-user'));

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data?.user.login).toBe('cached-user');
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

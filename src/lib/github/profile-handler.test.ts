/**
 * Tests for `handleProfileRequest` auth graceful-degradation.
 *
 * A GitHub 401 (expired/revoked user token) must surface as a real HTTP 401 so
 * the client redirects to /sign-in — NOT as demo fallback data served at 200,
 * which silently masks the dead session. Non-auth failures must still degrade
 * to the demo fallback so a transient GitHub outage doesn't bounce the user out.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getOctokitForRequest = vi.fn();
const getAuthenticatedUser = vi.fn();
const getUserRepositories = vi.fn();
const getUserEvents = vi.fn();
const getCachedProfile = vi.fn();
const setCachedProfile = vi.fn();

vi.mock('@/lib/github/client', () => ({
  getOctokitForRequest: () => getOctokitForRequest(),
}));

vi.mock('@/lib/auth/context', () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

vi.mock('@/lib/github', () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
  getUserRepositories: (...args: unknown[]) => getUserRepositories(...args),
  getUserEvents: (...args: unknown[]) => getUserEvents(...args),
  calculateActivityMetrics: () => ({ commits: 0, pullRequests: 0, reposUpdated: 0 }),
  calculateExperienceLevel: () => 'beginner' as const,
  calculateYearsOnGitHub: () => 1,
  getLanguageStats: () => [],
}));

vi.mock('@/lib/github/profile-cache', () => ({
  getCachedProfile: (...args: unknown[]) => getCachedProfile(...args),
  setCachedProfile: (...args: unknown[]) => setCachedProfile(...args),
}));

const { handleProfileRequest } = await import('./profile-handler');

const SAMPLE_USER = {
  login: 'octocat',
  name: 'The Octocat',
  avatarUrl: 'https://example.com/a.png',
  bio: null,
  company: null,
  location: null,
  followers: 10,
  following: 5,
  createdAt: '2015-01-01T00:00:00Z',
};

function githubError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

beforeEach(() => {
  vi.clearAllMocks();
  getOctokitForRequest.mockResolvedValue({});
  getCachedProfile.mockReturnValue(null);
  getUserEvents.mockResolvedValue([]);
});

describe('handleProfileRequest auth graceful degradation', () => {
  it('returns 401 when getAuthenticatedUser throws a GitHub 401 (by status)', async () => {
    getAuthenticatedUser.mockRejectedValue(githubError(401, 'Unauthorized'));

    const response = await handleProfileRequest();

    expect(response.status).toBe(401);
    // The dead session must NOT be cached as a successful profile.
    expect(setCachedProfile.mock.calls).toHaveLength(0);
  });

  it('returns 401 when getAuthenticatedUser fails with a "Bad credentials" message', async () => {
    getAuthenticatedUser.mockRejectedValue(new Error('HttpError: Bad credentials'));

    const response = await handleProfileRequest();

    expect(response.status).toBe(401);
  });

  it('returns 401 when getUserRepositories throws a GitHub 401', async () => {
    getAuthenticatedUser.mockResolvedValue(SAMPLE_USER);
    getUserRepositories.mockRejectedValue(githubError(401, 'Unauthorized'));

    const response = await handleProfileRequest();

    expect(response.status).toBe(401);
  });

  it('degrades to demo fallback (200) on a non-auth user fetch failure', async () => {
    getAuthenticatedUser.mockRejectedValue(githubError(503, 'Service Unavailable'));

    const response = await handleProfileRequest();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meta.method).toBe('fallback');
    expect(body.user.name).toBe('Demo User');
  });

  it('degrades to demo fallback (200) on a non-auth repos fetch failure', async () => {
    getAuthenticatedUser.mockResolvedValue(SAMPLE_USER);
    getUserRepositories.mockRejectedValue(githubError(500, 'Server Error'));

    const response = await handleProfileRequest();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meta.method).toBe('fallback');
  });

  it('returns a normal 200 profile when both fetches succeed', async () => {
    getAuthenticatedUser.mockResolvedValue(SAMPLE_USER);
    getUserRepositories.mockResolvedValue([]);

    const response = await handleProfileRequest();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.login).toBe('octocat');
    expect(body.meta.method).toBe('octokit-direct');
  });

  it('returns 401 when the activity fetch throws a GitHub 401 on the fresh path', async () => {
    // The token can be revoked after getAuthenticatedUser/getUserRepositories
    // succeed but before the events call; that 401 must signal re-auth, not be
    // masked as a 200 profile with zero activity.
    getAuthenticatedUser.mockResolvedValue(SAMPLE_USER);
    getUserRepositories.mockResolvedValue([]);
    getUserEvents.mockRejectedValue(githubError(401, 'Unauthorized'));

    const response = await handleProfileRequest();

    expect(response.status).toBe(401);
  });

  it('returns 401 when the activity fetch throws a GitHub 401 on the cached path', async () => {
    // On the cached-repo path the events call is the only live GitHub request,
    // so a 401 there is the only signal that the session has died — it must
    // surface as a 401 rather than returning the stale cached profile.
    getAuthenticatedUser.mockResolvedValue(SAMPLE_USER);
    getCachedProfile.mockReturnValue({ user: SAMPLE_USER, repos: [] });
    getUserEvents.mockRejectedValue(githubError(401, 'Unauthorized'));

    const response = await handleProfileRequest();

    expect(response.status).toBe(401);
    // A cache hit must not have re-fetched repos.
    expect(getUserRepositories.mock.calls).toHaveLength(0);
  });

  it('degrades activity to an empty tally (200) on a non-auth events failure', async () => {
    // A transient events-endpoint error is not a dead session; the profile is
    // complete without activity, so it should still return 200.
    getAuthenticatedUser.mockResolvedValue(SAMPLE_USER);
    getUserRepositories.mockResolvedValue([]);
    getUserEvents.mockRejectedValue(githubError(503, 'Service Unavailable'));

    const response = await handleProfileRequest();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pastSevenDays).toEqual({ commits: 0, pullRequests: 0, reposUpdated: 0 });
  });
});

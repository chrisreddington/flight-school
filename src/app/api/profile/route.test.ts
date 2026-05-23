import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks, UnauthorizedErrorMock } = vi.hoisted(() => {
  class UnauthorizedErrorMock extends Error {
    constructor(message = 'Authentication required') {
      super(message);
      this.name = 'UnauthorizedError';
    }
  }
  return {
    mocks: {
      getOctokitForRequest: vi.fn(),
    },
    UnauthorizedErrorMock,
  };
});

vi.mock('@/lib/github/client', () => ({
  getOctokitForRequest: mocks.getOctokitForRequest,
}));

vi.mock('@/lib/auth/context', () => ({
  UnauthorizedError: UnauthorizedErrorMock,
}));

vi.mock('@/lib/github', () => ({
  calculateActivityMetrics: vi.fn(),
  calculateExperienceLevel: vi.fn(),
  calculateYearsOnGitHub: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  getLanguageStats: vi.fn(),
  getUserEvents: vi.fn(),
  getUserRepositories: vi.fn(),
}));

vi.mock('@/lib/github/profile-cache', () => ({
  getCachedProfile: vi.fn(),
  setCachedProfile: vi.fn(),
}));

import { GET } from './route';

describe('/api/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when request auth is stale or missing', async () => {
    mocks.getOctokitForRequest.mockRejectedValue(new UnauthorizedErrorMock());

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Authentication required' });
  });
});

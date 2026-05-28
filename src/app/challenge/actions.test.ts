/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionIdentity } from '@/lib/copilot/session-identity';
import type { DailyChallenge } from '@/lib/focus/types';
import { RateLimitedError } from '@/lib/security/rate-limit';
import { TooManyConcurrentSessionsError } from '@/lib/security/session-cap';

const {
  requireGuardedUserContextMock,
  createSessionIdentityMock,
  generateFocusMock,
  readUserChallengeSpecMock,
  writeUserChallengeSpecMock,
  UnauthorizedErrorMock,
} = vi.hoisted(() => ({
  requireGuardedUserContextMock: vi.fn(),
  createSessionIdentityMock: vi.fn(),
  generateFocusMock: vi.fn(),
  readUserChallengeSpecMock: vi.fn(),
  writeUserChallengeSpecMock: vi.fn(),
  UnauthorizedErrorMock: class UnauthorizedError extends Error {
    readonly status = 401;
    constructor(message = 'Authentication required') {
      super(message);
      this.name = 'UnauthorizedError';
    }
  },
}));

vi.mock('@/lib/security/guard', () => ({
  requireGuardedUserContext: requireGuardedUserContextMock,
}));

vi.mock('@/lib/copilot/session-identity', () => ({
  createSessionIdentity: createSessionIdentityMock,
}));

vi.mock('@/lib/focus/handlers', () => ({
  generateFocus: generateFocusMock,
}));

vi.mock('@/lib/challenge/spec-storage', () => ({
  readUserChallengeSpec: readUserChallengeSpecMock,
  writeUserChallengeSpec: writeUserChallengeSpecMock,
}));

vi.mock('@/lib/auth/context', () => ({
  UnauthorizedError: UnauthorizedErrorMock,
}));

vi.mock('@/lib/storage/user-storage', () => ({
  readUserStorage: vi.fn(),
  writeUserStorage: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

function createChallenge(id: string, title: string): DailyChallenge {
  return {
    id,
    title,
    description: 'desc',
    difficulty: 'beginner',
    language: 'TypeScript',
    estimatedTime: '30 minutes',
    whyThisChallenge: ['reason'],
  };
}

describe('regenerateChallengeAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns unauthenticated when the guard throws UnauthorizedError', async () => {
    requireGuardedUserContextMock.mockRejectedValue(new UnauthorizedErrorMock());

    const { regenerateChallengeAction } = await import('./actions');
    await expect(regenerateChallengeAction()).resolves.toEqual({ ok: false, error: 'unauthenticated' });
  });

  it('returns rate-limited with retryAfterMs when the guard throws RateLimitedError', async () => {
    requireGuardedUserContextMock.mockRejectedValue(new RateLimitedError(1234));

    const { regenerateChallengeAction } = await import('./actions');
    await expect(regenerateChallengeAction()).resolves.toEqual({
      ok: false,
      error: 'rate-limited',
      retryAfterMs: 1234,
    });
  });

  it('returns concurrent-cap when the guard throws TooManyConcurrentSessionsError', async () => {
    requireGuardedUserContextMock.mockRejectedValue(new TooManyConcurrentSessionsError(3));

    const { regenerateChallengeAction } = await import('./actions');
    await expect(regenerateChallengeAction()).resolves.toEqual({ ok: false, error: 'concurrent-cap' });
  });

  it('returns generation-failed when focus generation has no challenge', async () => {
    const release = vi.fn();
    requireGuardedUserContextMock.mockResolvedValue({
      ctx: { userId: 'u1', login: 'octocat', accessToken: 'ghu_x' },
      release,
    });
    const identity: SessionIdentity = { userId: 'u1', gitHubToken: 'ghu_x' };
    createSessionIdentityMock.mockReturnValue(identity);
    generateFocusMock.mockResolvedValue({ goal: { id: 'g1', title: 'Goal', actions: [] } });

    const { regenerateChallengeAction } = await import('./actions');
    await expect(regenerateChallengeAction()).resolves.toEqual({ ok: false, error: 'generation-failed' });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('passes current challenge title as an exclusion and persists the new challenge', async () => {
    const release = vi.fn();
    requireGuardedUserContextMock.mockResolvedValue({
      ctx: { userId: 'u1', login: 'octocat', accessToken: 'ghu_x' },
      release,
    });
    const identity: SessionIdentity = { userId: 'u1', gitHubToken: 'ghu_x' };
    createSessionIdentityMock.mockReturnValue(identity);
    readUserChallengeSpecMock.mockResolvedValue(createChallenge('old-id', 'Old Challenge'));
    const freshChallenge = createChallenge('new-id', 'New Challenge');
    generateFocusMock.mockResolvedValue({ challenge: freshChallenge });

    const { regenerateChallengeAction } = await import('./actions');
    await expect(regenerateChallengeAction({ currentChallengeId: 'old-id' })).resolves.toEqual({
      ok: true,
      challenge: freshChallenge,
    });
    expect(generateFocusMock).toHaveBeenCalledWith(identity, {
      component: 'challenge',
      existingChallengeTitles: ['Old Challenge'],
    });
    expect(writeUserChallengeSpecMock).toHaveBeenCalledWith('new-id', freshChallenge);
    expect(release).toHaveBeenCalledTimes(1);
  });
});

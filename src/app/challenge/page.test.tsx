import type { DailyChallenge } from '@/lib/focus/base-types';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { redirectMock, notFoundMock, readUserChallengeSpecMock, requireGuardedRscContextMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((target: string) => {
    throw new Error(`REDIRECT:${target}`);
  }),
  notFoundMock: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  readUserChallengeSpecMock: vi.fn(),
  requireGuardedRscContextMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  notFound: notFoundMock,
}));

vi.mock('@/lib/challenge/spec-storage', () => ({
  readUserChallengeSpec: readUserChallengeSpecMock,
}));

vi.mock('@/lib/security/guard', () => ({
  requireGuardedRscContext: requireGuardedRscContextMock,
}));

vi.mock('./challenge-page-client', () => ({
  ChallengePageClient: () => null,
}));

const STORED_CHALLENGE_SPEC: DailyChallenge = {
  id: 'stored-id',
  title: 'Stored Challenge',
  description: 'Stored description',
  difficulty: 'beginner',
  language: 'TypeScript',
  estimatedTime: '30 minutes',
  whyThisChallenge: [],
};

describe('ChallengePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireGuardedRscContextMock.mockResolvedValue({ userId: 'user-1' });
  });

  it('redirects to "/" when a valid id has no stored spec', async () => {
    readUserChallengeSpecMock.mockResolvedValue(null);

    const { default: ChallengePage } = await import('./page');

    await expect(ChallengePage({ searchParams: Promise.resolve({ id: 'missing-spec' }) })).rejects.toThrow(
      'REDIRECT:/',
    );
  });

  it('ignores legacy crafted query fields and renders the stored server-side spec', async () => {
    readUserChallengeSpecMock.mockResolvedValue(STORED_CHALLENGE_SPEC);

    const { default: ChallengePage } = await import('./page');

    const rendered = (await ChallengePage({
      searchParams: Promise.resolve({
        id: 'stored-id',
        title: 'Injected title',
        description: 'Injected description',
      }) as Promise<{ id?: string | string[] }>,
    })) as ReactElement<{ challenge: { title: string; description: string } }>;

    expect(rendered.props.challenge.title).toBe('Stored Challenge');
    expect(rendered.props.challenge.description).toBe('Stored description');
  });

  it('treats invalid ids as not found', async () => {
    const { default: ChallengePage } = await import('./page');

    await expect(ChallengePage({ searchParams: Promise.resolve({ id: '../escape' }) })).rejects.toThrow('NOT_FOUND');
  });
});

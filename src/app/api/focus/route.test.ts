import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FocusResponse } from '@/lib/focus/types';
import type { SkillProfile } from '@/lib/skills/types';

const mocks = vi.hoisted(() => ({
  createSessionIdentity: vi.fn(),
  generateFocus: vi.fn(),
  readUserSkillsProfile: vi.fn(),
  withGuardedRoute: vi.fn(),
  writeUserChallengeSpec: vi.fn(),
}));

vi.mock('@/lib/copilot/session-identity', () => ({
  createSessionIdentity: mocks.createSessionIdentity,
}));

vi.mock('@/lib/focus/handlers', () => ({
  generateFocus: mocks.generateFocus,
}));

vi.mock('@/lib/skills/server', () => ({
  readUserSkillsProfile: mocks.readUserSkillsProfile,
}));

vi.mock('@/lib/security/guard', () => ({
  withGuardedRoute: mocks.withGuardedRoute,
}));

vi.mock('@/lib/api', () => ({
  parseJsonBodyWithFallback: async (request: Request, fallback: unknown) => {
    try {
      return (await request.json()) as unknown;
    } catch {
      return fallback;
    }
  },
}));

vi.mock('@/lib/challenge/spec-storage', () => ({
  writeUserChallengeSpec: mocks.writeUserChallengeSpec,
}));

import { GET, POST } from './route';

function makePostRequest(body: unknown) {
  return new Request('http://localhost/api/focus', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

function buildProfile(overrides: Partial<SkillProfile> = {}): SkillProfile {
  return {
    skills: [{ skillId: 'typescript', level: 'intermediate', source: 'manual' }],
    lastUpdated: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildFocusResponse(lastUpdated: string): FocusResponse {
  return {
    challenge: {
      id: 'challenge-1',
      title: 'Challenge',
      description: 'desc',
      difficulty: 'beginner',
      language: 'TypeScript',
      estimatedMinutes: 20,
      tags: ['ts'],
    },
    goal: {
      id: 'goal-1',
      title: 'Goal',
      description: 'desc',
      category: 'technical',
      estimatedMinutes: 10,
    },
    learningTopics: [
      {
        id: 'topic-1',
        title: 'Topic',
        description: 'desc',
        category: 'language',
        estimatedMinutes: 10,
        resources: [],
      },
    ],
    meta: {
      generatedAt: '2026-05-01T00:00:00.000Z',
      aiEnabled: true,
      model: 'gpt-5-mini',
      toolsUsed: [],
      totalTimeMs: 100,
      usedCachedProfile: true,
      skillProfileLastUpdated: lastUpdated,
    },
  };
}

describe('/api/focus route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSessionIdentity.mockReturnValue({ userId: 'u-1', gitHubToken: 'token' });
    mocks.withGuardedRoute.mockImplementation(async (_opts, work) =>
      work({
        userId: 'u-1',
        login: 'octo',
        accessToken: 'token',
      }),
    );
    mocks.generateFocus.mockImplementation(async (_identity, options) => {
      const lastUpdated = (options as { skillProfile?: SkillProfile }).skillProfile?.lastUpdated ?? '';
      return buildFocusResponse(lastUpdated);
    });
    mocks.readUserSkillsProfile.mockResolvedValue(buildProfile());
    mocks.writeUserChallengeSpec.mockResolvedValue(undefined);
  });

  it('hydrates GET from server skills profile and returns skillProfileLastUpdated meta', async () => {
    const serverProfile = buildProfile({ lastUpdated: '2026-05-03T00:00:00.000Z' });
    mocks.readUserSkillsProfile.mockResolvedValue(serverProfile);

    const response = await GET();
    const body = (await response.json()) as FocusResponse;

    expect(response.status).toBe(200);
    expect(body.challenge.id).toBe('challenge-1');
    expect(body.meta.skillProfileLastUpdated).toBe('2026-05-03T00:00:00.000Z');
  });

  it('prefers server skill profile when client payload is stale', async () => {
    const serverProfile = buildProfile({ lastUpdated: '2026-05-05T00:00:00.000Z' });
    const staleClientProfile = buildProfile({ lastUpdated: '2026-05-01T00:00:00.000Z' });
    mocks.readUserSkillsProfile.mockResolvedValue(serverProfile);

    const response = await POST(
      makePostRequest({
        skillProfile: staleClientProfile,
        existingChallengeTitles: ['Foo'],
      }),
    );

    const body = (await response.json()) as FocusResponse;

    expect(response.status).toBe(200);
    expect(body.goal.id).toBe('goal-1');
    expect(body.meta.skillProfileLastUpdated).toBe('2026-05-05T00:00:00.000Z');
  });

  it('rejects invalid existingChallengeTitles payloads', async () => {
    const response = await POST(
      makePostRequest({
        existingChallengeTitles: ['x'.repeat(201)],
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain('cannot exceed 200 characters');
  });
});

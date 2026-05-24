/**
 * Cross-cutting tests for D2: HIGH-severity inconsistent handling of
 * `CopilotEntitlementRequiredError` across AI routes.
 *
 * Verifies every Copilot-backed AI route returns 402 `{ error: 'copilot_required' }`
 * when the underlying SDK call throws `CopilotEntitlementRequiredError`, and
 * falls back to its prior behaviour (static fallback or 500) for unrelated
 * errors. The static fallback is for "the deployment has no AI configured",
 * not "this user has no Copilot license".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Hoisted mocks ----------

const hoisted = vi.hoisted(() => ({
  requireUserContextMock: vi.fn(),
  // copilot/execution — worker dispatch primitive used by every coach caller
  executeCopilotCoachJobMock: vi.fn(),
  // higher-level generator helpers
  generateGuidedPlanMock: vi.fn(),
  generateTopicQuizMock: vi.fn(),
  generateWhatsNextMock: vi.fn(),
  // authoring streaming session
  createGenericStreamingSessionMock: vi.fn(),
  // octokit / profile fetch — always fail softly so we focus on the AI path
  getOctokitForRequestMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireUserContext: hoisted.requireUserContextMock,
  UnauthorizedError: class UnauthorizedError extends Error {
    readonly status = 401;
    constructor(message = 'Authentication required') {
      super(message);
      this.name = 'UnauthorizedError';
    }
  },
}));

vi.mock('@/lib/copilot/execution', () => ({
  executeCopilotCoachJob: hoisted.executeCopilotCoachJobMock,
}));

vi.mock('@/lib/copilot/session-identity', () => ({
  createSessionIdentity: (ctx: { userId: string; accessToken: string }) => ({
    userId: ctx.userId,
    gitHubToken: ctx.accessToken,
  }),
}));

vi.mock('@/lib/copilot/guided-mode', async () => {
  const actual = await vi.importActual<typeof import('@/lib/copilot/guided-mode')>(
    '@/lib/copilot/guided-mode',
  );
  return {
    ...actual,
    generateGuidedPlan: hoisted.generateGuidedPlanMock,
  };
});

vi.mock('@/lib/copilot/quiz', async () => {
  const actual = await vi.importActual<typeof import('@/lib/copilot/quiz')>(
    '@/lib/copilot/quiz',
  );
  return {
    ...actual,
    generateTopicQuiz: hoisted.generateTopicQuizMock,
  };
});

vi.mock('@/lib/copilot/suggestions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/copilot/suggestions')>(
    '@/lib/copilot/suggestions',
  );
  return {
    ...actual,
    generateWhatsNext: hoisted.generateWhatsNextMock,
  };
});

vi.mock('@/lib/challenge/authoring/authoring-session', () => ({
  createGenericStreamingSession: hoisted.createGenericStreamingSessionMock,
}));

vi.mock('@/lib/github/client', () => ({
  getOctokitForRequest: hoisted.getOctokitForRequestMock,
  getOctokitForToken: vi.fn(),
  getGitHubToken: vi.fn(),
  isGitHubConfigured: vi.fn(),
}));

vi.mock('@/lib/github/profile', () => ({
  buildCompactContext: vi.fn().mockResolvedValue({}),
  serializeContext: vi.fn().mockReturnValue(''),
}));

// ---------- Imports after mocks ----------

import { CopilotEntitlementRequiredError } from '@/lib/copilot/entitlement';
import { __resetAuditState } from '@/lib/security/audit';
import { __resetRateLimitState } from '@/lib/security/rate-limit';
import { __resetSessionCapState } from '@/lib/security/session-cap';

// Helpers ---------------------------------------------------------------

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

const FAKE_USER = { userId: 'user-1', login: 'alice', accessToken: 'ghu_token' };

beforeEach(() => {
  process.env.AUDIT_SALT = 'entitlement-test-salt';
  __resetRateLimitState();
  __resetSessionCapState();
  __resetAuditState();
  hoisted.requireUserContextMock.mockResolvedValue(FAKE_USER);
  hoisted.getOctokitForRequestMock.mockRejectedValue(new Error('profile fetch skipped'));
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------- Per-route tests ----------

describe('AI route entitlement mapping (D2)', () => {
  describe('POST /api/focus', () => {
    it('returns 402 copilot_required when SDK throws CopilotEntitlementRequiredError', async () => {
      hoisted.executeCopilotCoachJobMock.mockRejectedValue(
        new CopilotEntitlementRequiredError('Need Copilot'),
      );
      const { POST } = await import('@/app/api/focus/route');
      const res = await POST(jsonRequest('http://localhost/api/focus', { component: 'goal' }));
      expect(res.status).toBe(402);
      const body = await res.json();
      expect(body.error).toBe('copilot_required');
    });

    it('falls back to static content for unrelated errors', async () => {
      hoisted.executeCopilotCoachJobMock.mockRejectedValue(new Error('boom'));
      const { POST } = await import('@/app/api/focus/route');
      const res = await POST(jsonRequest('http://localhost/api/focus', { component: 'goal' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.meta?.aiEnabled).toBe(false);
      expect(body.goal).toBeDefined();
    });

    it.each([
      ['challenge', 'challenge'],
      ['goal', 'goal'],
      ['learningTopics', 'learningTopics'],
    ] as const)('returns only the requested %s fallback component for unrelated errors', async (component, key) => {
      hoisted.executeCopilotCoachJobMock.mockRejectedValue(new Error('boom'));
      const { POST } = await import('@/app/api/focus/route');
      const res = await POST(jsonRequest('http://localhost/api/focus', { component }));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.meta).toMatchObject({ aiEnabled: false, model: 'fallback' });
      expect(body[key]).toBeDefined();
      for (const otherKey of ['challenge', 'goal', 'learningTopics'].filter((candidate) => candidate !== key)) {
        expect(body).not.toHaveProperty(otherKey);
      }
    });
  });

  describe('POST /api/guided-plan', () => {
    it('returns 402 when generateGuidedPlan throws CopilotEntitlementRequiredError', async () => {
      hoisted.generateGuidedPlanMock.mockRejectedValue(new CopilotEntitlementRequiredError());
      const { POST } = await import('@/app/api/guided-plan/route');
      const res = await POST(
        jsonRequest('http://localhost/api/guided-plan', {
          challengeTitle: 'T',
          challengeDescription: 'D',
          challengeLanguage: 'TypeScript',
          challengeDifficulty: 'beginner',
        }),
      );
      expect(res.status).toBe(402);
      expect((await res.json()).error).toBe('copilot_required');
    });

    it('returns static fallback for unrelated errors', async () => {
      hoisted.generateGuidedPlanMock.mockRejectedValue(new Error('boom'));
      const { POST } = await import('@/app/api/guided-plan/route');
      const res = await POST(
        jsonRequest('http://localhost/api/guided-plan', {
          challengeTitle: 'T',
          challengeDescription: 'D',
          challengeLanguage: 'TypeScript',
          challengeDifficulty: 'beginner',
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.error).toBeUndefined();
    });
  });

  describe('POST /api/quiz', () => {
    it('returns 402 when generateTopicQuiz throws CopilotEntitlementRequiredError', async () => {
      hoisted.generateTopicQuizMock.mockRejectedValue(new CopilotEntitlementRequiredError());
      const { POST } = await import('@/app/api/quiz/route');
      const res = await POST(
        jsonRequest('http://localhost/api/quiz', {
          topicTitle: 'X',
          topicDescription: 'Y',
        }),
      );
      expect(res.status).toBe(402);
      expect((await res.json()).error).toBe('copilot_required');
    });

    it('returns 500 for unrelated, non-AI-unavailable errors', async () => {
      hoisted.generateTopicQuizMock.mockRejectedValue(new Error('totally unexpected'));
      const { POST } = await import('@/app/api/quiz/route');
      const res = await POST(
        jsonRequest('http://localhost/api/quiz', {
          topicTitle: 'X',
          topicDescription: 'Y',
        }),
      );
      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/suggestions', () => {
    it('returns 402 when generateWhatsNext throws CopilotEntitlementRequiredError', async () => {
      hoisted.generateWhatsNextMock.mockRejectedValue(new CopilotEntitlementRequiredError());
      const { POST } = await import('@/app/api/suggestions/route');
      const res = await POST(
        jsonRequest('http://localhost/api/suggestions', {
          challengeTitle: 'C',
          challengeLanguage: 'TypeScript',
          challengeDifficulty: 'beginner',
        }),
      );
      expect(res.status).toBe(402);
      expect((await res.json()).error).toBe('copilot_required');
    });

    it('falls back to static suggestions for unrelated errors', async () => {
      hoisted.generateWhatsNextMock.mockRejectedValue(new Error('boom'));
      const { POST } = await import('@/app/api/suggestions/route');
      const res = await POST(
        jsonRequest('http://localhost/api/suggestions', {
          challengeTitle: 'C',
          challengeLanguage: 'TypeScript',
          challengeDifficulty: 'beginner',
        }),
      );
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/challenge/author', () => {
    it('returns 402 when createGenericStreamingSession throws CopilotEntitlementRequiredError', async () => {
      hoisted.createGenericStreamingSessionMock.mockRejectedValue(
        new CopilotEntitlementRequiredError(),
      );
      const { POST } = await import('@/app/api/challenge/author/route');
      const res = await POST(
        jsonRequest('http://localhost/api/challenge/author', {
          prompt: 'make me a challenge about recursion',
        }),
      );
      expect(res.status).toBe(402);
      const body = await res.json();
      expect(body.error).toBe('copilot_required');
    });

    it('returns 500 for unrelated errors', async () => {
      hoisted.createGenericStreamingSessionMock.mockRejectedValue(new Error('boom'));
      const { POST } = await import('@/app/api/challenge/author/route');
      const res = await POST(
        jsonRequest('http://localhost/api/challenge/author', {
          prompt: 'make me a challenge about recursion',
        }),
      );
      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/challenge/solve', () => {
    it('returns 402 when createLoggedCoachSession throws CopilotEntitlementRequiredError', async () => {
      hoisted.executeCopilotCoachJobMock.mockRejectedValue(
        new CopilotEntitlementRequiredError(),
      );
      const { POST } = await import('@/app/api/challenge/solve/route');
      const res = await POST(
        jsonRequest('http://localhost/api/challenge/solve', {
          challenge: {
            id: 'c1',
            title: 'T',
            description: 'D',
            language: 'TypeScript',
            difficulty: 'beginner',
          },
          files: [{ name: 'solution.ts', content: '' }],
        }),
      );
      expect(res.status).toBe(402);
      const body = await res.json();
      expect(body.error).toBe('copilot_required');
    });

    it('returns 500 for unrelated errors', async () => {
      hoisted.executeCopilotCoachJobMock.mockRejectedValue(new Error('boom'));
      const { POST } = await import('@/app/api/challenge/solve/route');
      const res = await POST(
        jsonRequest('http://localhost/api/challenge/solve', {
          challenge: {
            id: 'c1',
            title: 'T',
            description: 'D',
            language: 'TypeScript',
            difficulty: 'beginner',
          },
          files: [{ name: 'solution.ts', content: '' }],
        }),
      );
      expect(res.status).toBe(500);
    });
  });
});

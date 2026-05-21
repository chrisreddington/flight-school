/**
 * Tests asserting that background jobs never carry the access token on
 * their payload, and that executors resolve a fresh token at run-time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireUserContextMock,
  resolveFreshGitHubTokenMock,
  jobStorageMock,
  setImmediateMock,
  auditLogMock,
} = vi.hoisted(() => ({
  requireUserContextMock: vi.fn(),
  resolveFreshGitHubTokenMock: vi.fn(),
  jobStorageMock: {
    create: vi.fn(),
    invalidateCache: vi.fn(),
    get: vi.fn(),
    getAll: vi.fn(),
    getByType: vi.fn(),
    markRunning: vi.fn(),
    markFailed: vi.fn(),
    markCompleted: vi.fn(),
    markCancelled: vi.fn(),
  },
  setImmediateMock: vi.fn(),
  auditLogMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireUserContext: requireUserContextMock,
}));

vi.mock('@/lib/auth/token-resolver', () => ({
  resolveFreshGitHubToken: resolveFreshGitHubTokenMock,
}));

vi.mock('@/lib/jobs', () => ({
  jobStorage: jobStorageMock,
}));

vi.mock('@/lib/security/audit', () => ({
  auditLog: auditLogMock,
  hashUserId: (id: string) => `hash(${id})`,
}));

// The executors themselves are mocked so the route test focuses on payload shape.
const executorMocks = vi.hoisted(() => ({
  executeTopicRegeneration: vi.fn().mockResolvedValue(undefined),
  executeChallengeRegeneration: vi.fn().mockResolvedValue(undefined),
  executeGoalRegeneration: vi.fn().mockResolvedValue(undefined),
  executeChatResponse: vi.fn().mockResolvedValue(undefined),
  executeChallengeEvaluation: vi.fn().mockResolvedValue(undefined),
  getRegisteredSession: vi.fn(),
  unregisterSession: vi.fn(),
}));

vi.mock('./job-executors', () => executorMocks);

// Wire setImmediate so the route test can synchronously observe calls.
beforeEach(() => {
  vi.stubGlobal('setImmediate', (cb: () => void) => {
    setImmediateMock(cb);
    cb();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

import { POST } from './route';

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

describe('POST /api/jobs', () => {
  beforeEach(() => {
    requireUserContextMock.mockResolvedValue({
      userId: 'user-1',
      login: 'alice',
      accessToken: 'ghu_request_time_token',
    });
    jobStorageMock.create.mockImplementation(async (job: { id: string; type: string }) => ({
      ...job,
      status: 'pending',
      input: {},
      createdAt: new Date().toISOString(),
    }));
  });

  it('persists the job with no access token field on the payload', async () => {
    const input = { existingTopicTitles: ['a'], skillProfile: { level: 'beginner' } };
    await POST(makeRequest({ type: 'topic-regeneration', input }));

    expect(jobStorageMock.create).toHaveBeenCalledTimes(1);
    const stored = jobStorageMock.create.mock.calls[0][0];
    const serialised = JSON.stringify(stored);
    // Must not leak the request-time access token onto the persisted job.
    expect(serialised).not.toContain('ghu_request_time_token');
    expect(serialised).not.toContain('accessToken');
    expect(serialised).not.toContain('gitHubToken');
  });

  it('passes only userId (not an access token) to the executor', async () => {
    const input = { existingTopicTitles: [], skillProfile: { level: 'beginner' } };
    await POST(makeRequest({ type: 'topic-regeneration', input }));

    expect(executorMocks.executeTopicRegeneration).toHaveBeenCalledTimes(1);
    const args = executorMocks.executeTopicRegeneration.mock.calls[0];
    expect(args[2]).toBe('user-1');
    // Defensive: the third arg must be a string, never an identity object.
    expect(typeof args[2]).toBe('string');
  });

  it('routes each job type to its executor with userId only', async () => {
    const cases: Array<[string, ReturnType<typeof vi.fn>]> = [
      ['challenge-regeneration', executorMocks.executeChallengeRegeneration],
      ['goal-regeneration', executorMocks.executeGoalRegeneration],
      ['chat-response', executorMocks.executeChatResponse],
      ['challenge-evaluation', executorMocks.executeChallengeEvaluation],
    ];
    for (const [type, mock] of cases) {
      mock.mockClear();
      await POST(makeRequest({ type, input: {} }));
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock.mock.calls[0][2]).toBe('user-1');
    }
  });
});

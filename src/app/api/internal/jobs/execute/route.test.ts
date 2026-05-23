import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  scheduleWorkerJobExecution: vi.fn(),
  jobStorageGet: vi.fn(),
  jobStorageMarkRunning: vi.fn(),
  setTokenIfNewer: vi.fn(),
  withExtractedTraceContext: vi.fn(),
}));

vi.mock('./executor', () => ({
  scheduleWorkerJobExecution: mocks.scheduleWorkerJobExecution,
}));

vi.mock('@/lib/jobs', () => ({
  jobStorage: {
    get: mocks.jobStorageGet,
    markRunning: mocks.jobStorageMarkRunning,
  },
}));

vi.mock('@/lib/auth/token-store', () => ({
  getTokenStore: () => ({
    setTokenIfNewer: mocks.setTokenIfNewer,
  }),
}));

vi.mock('@/lib/observability/context-propagation', () => ({
  withExtractedTraceContext: mocks.withExtractedTraceContext,
}));

import { POST } from './route';

function makeRequest(body: unknown, token = 'local-secret') {
  return new Request('http://localhost/api/internal/jobs/execute', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }) as never;
}

describe('/api/internal/jobs/execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('COPILOT_WORKER_MODE', '1');
    vi.stubEnv('COPILOT_WORKER_SECRET', 'local-secret');
    mocks.jobStorageGet.mockResolvedValue({
      id: 'job-1',
      userId: 'user-1',
      status: 'pending',
    });
    mocks.jobStorageMarkRunning.mockResolvedValue({});
    mocks.setTokenIfNewer.mockResolvedValue(true);
    mocks.withExtractedTraceContext.mockImplementation(
      async (_headers: unknown, operation: (extractedContext: unknown) => unknown) =>
        await operation({}),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 404 when worker mode is disabled', async () => {
    vi.stubEnv('COPILOT_WORKER_MODE', '0');

    const response = await POST(makeRequest({}));

    expect(response.status).toBe(404);
    expect(mocks.scheduleWorkerJobExecution).not.toHaveBeenCalled();
  });

  it('returns 401 when bearer auth is invalid', async () => {
    const response = await POST(makeRequest({}, 'wrong-secret'));

    expect(response.status).toBe(401);
    expect(mocks.scheduleWorkerJobExecution).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid requests', async () => {
    const response = await POST(makeRequest({ jobId: 'job-1' }));

    expect(response.status).toBe(400);
    expect(mocks.scheduleWorkerJobExecution).not.toHaveBeenCalled();
  });

  it('returns 404 when job ownership does not match request user', async () => {
    mocks.jobStorageGet.mockResolvedValue({
      id: 'job-1',
      userId: 'other-user',
      status: 'pending',
    });

    const response = await POST(makeRequest({
      jobId: 'job-1',
      type: 'chat-response',
      input: { threadId: 'thread-1', prompt: 'hello' },
      userId: 'user-1',
    }));

    expect(response.status).toBe(404);
    expect(mocks.scheduleWorkerJobExecution).not.toHaveBeenCalled();
  });

  it('returns 400 when credentials are partially provided', async () => {
    const response = await POST(makeRequest({
      jobId: 'job-1',
      type: 'chat-response',
      input: { threadId: 'thread-1', prompt: 'hello' },
      userId: 'user-1',
      credentials: {
        accessToken: 'ghu_user',
      },
    }));

    expect(response.status).toBe(400);
    expect(mocks.setTokenIfNewer).not.toHaveBeenCalled();
    expect(mocks.scheduleWorkerJobExecution).not.toHaveBeenCalled();
  });

  it('seeds token store then marks running and schedules execution', async () => {
    const response = await POST(makeRequest({
      jobId: 'job-1',
      type: 'chat-response',
      input: { threadId: 'thread-1', prompt: 'hello' },
      userId: 'user-1',
      credentials: {
        accessToken: 'ghu_user',
        refreshToken: 'ghr_user',
        expiresAt: 1_700_000_000,
      },
    }));

    expect(response.status).toBe(202);
    expect(mocks.setTokenIfNewer).toHaveBeenCalledWith('user-1', {
      accessToken: 'ghu_user',
      refreshToken: 'ghr_user',
      expiresAt: 1_700_000_000,
    });
    expect(mocks.jobStorageMarkRunning).toHaveBeenCalledWith('job-1');
    expect(mocks.scheduleWorkerJobExecution).toHaveBeenCalledWith({
      jobId: 'job-1',
      type: 'chat-response',
      input: { threadId: 'thread-1', prompt: 'hello' },
      userId: 'user-1',
    }, undefined);
    expect(mocks.setTokenIfNewer.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.scheduleWorkerJobExecution.mock.invocationCallOrder[0],
    );
  });

  it('extracts trace context before scheduling worker execution', async () => {
    const response = await POST(makeRequest({
      jobId: 'job-1',
      type: 'chat-response',
      input: { threadId: 'thread-1', prompt: 'hello' },
      userId: 'user-1',
    }));

    expect(response.status).toBe(202);
    expect(mocks.withExtractedTraceContext).toHaveBeenCalledTimes(1);
  });

  it('forwards persisted causality metadata to worker scheduler', async () => {
    mocks.jobStorageGet.mockResolvedValue({
      id: 'job-1',
      userId: 'user-1',
      status: 'pending',
      causality: {
        traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
      },
    });

    const response = await POST(makeRequest({
      jobId: 'job-1',
      type: 'chat-response',
      input: { threadId: 'thread-1', prompt: 'hello' },
      userId: 'user-1',
    }));

    expect(response.status).toBe(202);
    expect(mocks.scheduleWorkerJobExecution).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1' }),
      expect.objectContaining({
        traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
      }),
    );
  });

  it('returns 202 and no-ops replayed non-pending jobs', async () => {
    mocks.jobStorageGet.mockResolvedValue({
      id: 'job-1',
      userId: 'user-1',
      status: 'completed',
    });

    const response = await POST(makeRequest({
      jobId: 'job-1',
      type: 'chat-response',
      input: { threadId: 'thread-1', prompt: 'hello' },
      userId: 'user-1',
    }));

    expect(response.status).toBe(202);
    expect(mocks.jobStorageMarkRunning).not.toHaveBeenCalled();
    expect(mocks.scheduleWorkerJobExecution).not.toHaveBeenCalled();
  });
});

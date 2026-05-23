import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUserContext: vi.fn(),
  seedTokenStoreFromJwt: vi.fn(),
  buildWorkerDispatchCredentials: vi.fn(),
  captureTracePropagationHeaders: vi.fn(),
  dispatchJobExecution: vi.fn(),
  cancelWorkerJob: vi.fn(),
  getActiveSpan: vi.fn(),
  setSpanAttributes: vi.fn(),
  jobStorage: {
    create: vi.fn(),
    get: vi.fn(),
    getAll: vi.fn(),
    getByType: vi.fn(),
    markCancelled: vi.fn(),
    invalidateCache: vi.fn(),
  },
}));

vi.mock('@/lib/auth/context', () => ({
  requireUserContext: mocks.requireUserContext,
}));

vi.mock('@/lib/auth/seed', () => ({
  seedTokenStoreFromJwt: mocks.seedTokenStoreFromJwt,
  buildWorkerDispatchCredentials: mocks.buildWorkerDispatchCredentials,
}));

vi.mock('@/lib/observability/context-propagation', () => ({
  captureTracePropagationHeaders: mocks.captureTracePropagationHeaders,
}));

vi.mock('@opentelemetry/api', () => ({
  SpanStatusCode: { OK: 1, ERROR: 2 },
  context: {
    active: vi.fn(() => ({})),
    with: vi.fn((_ctx: unknown, operation: () => unknown) => operation()),
  },
  metrics: {
    getMeter: vi.fn(() => ({
      createCounter: vi.fn(() => ({ add: vi.fn() })),
      createHistogram: vi.fn(() => ({ record: vi.fn() })),
    })),
  },
  trace: {
    getActiveSpan: mocks.getActiveSpan,
    getSpan: vi.fn(),
    getTracer: vi.fn(() => ({
      startSpan: vi.fn(() => ({
        end: vi.fn(),
        recordException: vi.fn(),
        setStatus: vi.fn(),
      })),
    })),
    setSpan: vi.fn((ctx: unknown) => ctx),
    wrapSpanContext: vi.fn((ctx: unknown) => ctx),
  },
}));

vi.mock('./dispatcher', () => ({
  dispatchJobExecution: mocks.dispatchJobExecution,
}));

vi.mock('./worker-client', () => ({
  cancelWorkerJob: mocks.cancelWorkerJob,
}));

vi.mock('@/lib/jobs', () => ({
  jobStorage: mocks.jobStorage,
}));

import { POST, cancelRunningJob } from './route';

function makeRequest(body: unknown, headers?: Record<string, string>) {
  return new Request('http://localhost/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  }) as never;
}

describe('POST /api/jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUserContext.mockResolvedValue({ userId: 'user-1', login: 'alice' });
    mocks.seedTokenStoreFromJwt.mockResolvedValue({ status: 'ok' });
    mocks.buildWorkerDispatchCredentials.mockResolvedValue({
      accessToken: 'ghu_user',
      refreshToken: 'ghr_user',
      expiresAt: 1_700_000_000,
    });
    mocks.captureTracePropagationHeaders.mockReturnValue({
      traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
      tracestate: 'vendor=value',
    });
    mocks.getActiveSpan.mockReturnValue({
      setAttributes: mocks.setSpanAttributes,
    });
    mocks.jobStorage.create.mockImplementation(async (job: { id: string; type: string }) => ({
      ...job,
      status: 'pending',
      createdAt: '2026-05-23T01:00:00.000Z',
    }));
    mocks.jobStorage.getAll.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 503 and does not dispatch when token-store seeding fails', async () => {
    mocks.seedTokenStoreFromJwt.mockResolvedValue({
      status: 'error',
      error: new Error('cosmos down'),
    });

    const response = await POST(makeRequest({ type: 'topic-regeneration', input: {} }));

    expect(response.status).toBe(503);
    expect(mocks.jobStorage.create).not.toHaveBeenCalled();
    expect(mocks.dispatchJobExecution).not.toHaveBeenCalled();
  });

  it('persists token-free job payloads and dispatches with userId', async () => {
    await POST(makeRequest({ type: 'topic-regeneration', input: { existingTopicTitles: [] } }));

    expect(mocks.jobStorage.create).toHaveBeenCalledTimes(1);
    const stored = mocks.jobStorage.create.mock.calls[0][0];
    const serialised = JSON.stringify(stored);
    expect(serialised).not.toContain('ghu_');
    expect(serialised).not.toContain('accessToken');
    expect(serialised).not.toContain('gitHubToken');

    expect(mocks.dispatchJobExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'topic-regeneration',
        userId: 'user-1',
      }),
    );
  });

  it('omits dispatch credentials in production unless explicitly enabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    await POST(makeRequest({ type: 'goal-regeneration', input: { existingGoalTitles: [] } }));

    expect(mocks.buildWorkerDispatchCredentials).not.toHaveBeenCalled();
    expect(mocks.dispatchJobExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: undefined,
      }),
    );
  });

  it('includes dispatch credentials in production when explicitly enabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('COPILOT_WORKER_DISPATCH_CREDENTIALS', '1');

    await POST(makeRequest({ type: 'goal-regeneration', input: { existingGoalTitles: [] } }));

    expect(mocks.buildWorkerDispatchCredentials).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchJobExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: {
          accessToken: 'ghu_user',
          refreshToken: 'ghr_user',
          expiresAt: 1_700_000_000,
        },
      }),
    );
  });

  it('captures trace context and forwards it in dispatch request metadata', async () => {
    await POST(makeRequest({ type: 'goal-regeneration', input: { existingGoalTitles: [] } }));

    expect(mocks.captureTracePropagationHeaders).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchJobExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        traceContext: {
          traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
          tracestate: 'vendor=value',
        },
      }),
    );
  });

  it('stores causality context on the persisted job record', async () => {
    await POST(makeRequest({ type: 'topic-regeneration', input: { existingTopicTitles: [] } }));

    expect(mocks.jobStorage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        causality: expect.objectContaining({
          traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
          tracestate: 'vendor=value',
        }),
      }),
    );
  });

  it('stores validated client trigger metadata in job causality', async () => {
    await POST(
      makeRequest(
        { type: 'goal-regeneration', input: { existingGoalTitles: [] } },
        {
          'x-flight-school-trigger-source': 'ai-focus',
          'x-flight-school-trigger-action': 'skip-goal',
          'x-flight-school-trigger-page-path': '/skills',
          'x-flight-school-trigger-navigation-elapsed-ms': '910',
          'x-flight-school-trigger-target-type': 'goal',
          'x-flight-school-trigger-target-id': 'goal-123',
          'x-flight-school-trigger-correlation-id': 'b9e8ad89-c6c4-42ef-ad52-f74f0bec71a6',
        },
      ),
    );

    expect(mocks.jobStorage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        causality: expect.objectContaining({
          trigger: {
            source: 'ai-focus',
            action: 'skip-goal',
            pagePath: '/skills',
            navigationElapsedMs: 910,
            targetType: 'goal',
            targetId: 'goal-123',
            correlationId: 'b9e8ad89-c6c4-42ef-ad52-f74f0bec71a6',
          },
        }),
      }),
    );
  });

  it('ignores malformed trigger metadata headers', async () => {
    await POST(
      makeRequest(
        { type: 'goal-regeneration', input: { existingGoalTitles: [] } },
        {
          'x-flight-school-trigger-source': 'ai-focus',
          'x-flight-school-trigger-action': 'skip-goal',
          'x-flight-school-trigger-correlation-id': 'not-a-uuid',
        },
      ),
    );

    expect(mocks.jobStorage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        causality: expect.not.objectContaining({
          trigger: expect.anything(),
        }),
      }),
    );
  });

  it('adds client trigger attributes to the active span', async () => {
    await POST(
      makeRequest(
        { type: 'goal-regeneration', input: { existingGoalTitles: [] } },
        {
          'x-flight-school-trigger-source': 'ai-focus',
          'x-flight-school-trigger-action': 'skip-goal',
          'x-flight-school-trigger-page-path': '/skills',
          'x-flight-school-trigger-navigation-elapsed-ms': '910',
          'x-flight-school-trigger-target-type': 'goal',
          'x-flight-school-trigger-target-id': 'goal-123',
          'x-flight-school-trigger-correlation-id': 'b9e8ad89-c6c4-42ef-ad52-f74f0bec71a6',
        },
      ),
    );

    expect(mocks.setSpanAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'app.trigger.source': 'ai-focus',
        'app.trigger.action': 'skip-goal',
        'app.trigger.page_path': '/skills',
        'app.trigger.navigation_elapsed_ms': 910,
        'app.trigger.target_type': 'goal',
        'app.trigger.target_id': 'goal-123',
        'app.trigger.correlation_id': 'b9e8ad89-c6c4-42ef-ad52-f74f0bec71a6',
      }),
    );
  });
});

describe('cancelRunningJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when the job does not exist', async () => {
    mocks.jobStorage.get.mockResolvedValue(undefined);

    await expect(cancelRunningJob('job-1')).resolves.toBe(false);
    expect(mocks.jobStorage.markCancelled).not.toHaveBeenCalled();
  });

  it('returns false when the job is already terminal', async () => {
    mocks.jobStorage.get.mockResolvedValue({ id: 'job-1', status: 'completed' });

    await expect(cancelRunningJob('job-1')).resolves.toBe(false);
    expect(mocks.jobStorage.markCancelled).not.toHaveBeenCalled();
  });

  it('marks job cancelled and forwards cancellation to worker', async () => {
    mocks.jobStorage.get.mockResolvedValue({ id: 'job-1', status: 'running' });
    mocks.cancelWorkerJob.mockResolvedValue(undefined);

    await expect(cancelRunningJob('job-1')).resolves.toBe(true);
    expect(mocks.jobStorage.markCancelled).toHaveBeenCalledWith('job-1');
    expect(mocks.cancelWorkerJob).toHaveBeenCalledWith('job-1');
  });

  it('still returns true when worker cancellation forwarding fails', async () => {
    mocks.jobStorage.get.mockResolvedValue({ id: 'job-1', status: 'running' });
    mocks.cancelWorkerJob.mockRejectedValue(new Error('network down'));

    await expect(cancelRunningJob('job-1')).resolves.toBe(true);
    expect(mocks.jobStorage.markCancelled).toHaveBeenCalledWith('job-1');
  });
});

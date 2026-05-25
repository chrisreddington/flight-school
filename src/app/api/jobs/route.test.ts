import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUserContext: vi.fn(),
  seedTokenStoreFromJwt: vi.fn(),
  buildWorkerDispatchCredentials: vi.fn(),
  captureTracePropagationHeaders: vi.fn(),
  createWorkerJob: vi.fn(),
  listWorkerJobs: vi.fn(),
  getActiveSpan: vi.fn(),
  setSpanAttributes: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireUserContext: mocks.requireUserContext,
  UnauthorizedError: class extends Error {},
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
  trace: {
    getActiveSpan: mocks.getActiveSpan,
    getSpan: () => undefined,
    getTracer: () => ({
      startSpan: () => ({
        setAttribute: vi.fn(),
        setAttributes: vi.fn(),
        setStatus: vi.fn(),
        recordException: vi.fn(),
        end: vi.fn(),
      }),
      startActiveSpan: (_n: string, fn: (s: unknown) => unknown) =>
        fn({
          setAttribute: vi.fn(),
          setAttributes: vi.fn(),
          setStatus: vi.fn(),
          recordException: vi.fn(),
          end: vi.fn(),
        }),
    }),
  },
  metrics: {
    getMeter: () => ({
      createHistogram: () => ({ record: vi.fn() }),
      createCounter: () => ({ add: vi.fn() }),
      createUpDownCounter: () => ({ add: vi.fn() }),
    }),
  },
  context: { active: () => ({}) },
  propagation: { inject: vi.fn(), extract: vi.fn() },
}));

vi.mock('./worker-client', () => ({
  createWorkerJob: mocks.createWorkerJob,
  listWorkerJobs: mocks.listWorkerJobs,
}));

import { GET, POST } from './route';

function makeRequest(body: unknown, headers?: Record<string, string>) {
  return new Request('http://localhost/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  }) as never;
}

function makeGetRequest(query = '') {
  return new Request(`http://localhost/api/jobs${query ? `?${query}` : ''}`, {
    method: 'GET',
  }) as never;
}

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
  mocks.getActiveSpan.mockReturnValue({ setAttributes: mocks.setSpanAttributes });
  mocks.createWorkerJob.mockImplementation(async (input: { id: string; type: string }) => ({
    id: input.id,
    type: input.type,
    status: 'pending',
    createdAt: '2026-05-23T01:00:00.000Z',
    userId: 'user-1',
    input: {},
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/jobs (proxy)', () => {
  it('returns 400 when type is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(mocks.createWorkerJob).not.toHaveBeenCalled();
  });

  it('returns 503 and does not dispatch when token-store seeding fails', async () => {
    mocks.seedTokenStoreFromJwt.mockResolvedValue({
      status: 'error',
      error: new Error('boom'),
    });

    const res = await POST(makeRequest({ type: 'topic-regeneration', input: {} }));

    expect(res.status).toBe(503);
    expect(mocks.createWorkerJob).not.toHaveBeenCalled();
  });

  it('forwards a generated id, normalised input, credentials and trace context', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    const res = await POST(
      makeRequest({
        type: 'chat-response',
        input: { threadId: 't1', prompt: 'hi', profile: 'chat' },
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.createWorkerJob).toHaveBeenCalledTimes(1);
    const input = mocks.createWorkerJob.mock.calls[0][0];
    expect(input).toMatchObject({
      type: 'chat-response',
      userId: 'user-1',
      credentials: expect.objectContaining({ accessToken: 'ghu_user' }),
      traceContext: expect.objectContaining({ traceparent: expect.any(String) }),
    });
    expect(input.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(input.input.assistantMessageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(input.causality).toMatchObject({
      traceparent: expect.any(String),
      capturedAt: expect.any(String),
    });
  });

  it('rejects malformed assistantMessageId', async () => {
    const res = await POST(
      makeRequest({
        type: 'chat-response',
        input: { threadId: 't1', prompt: 'hi', profile: 'chat', assistantMessageId: 'not-a-uuid' },
      }),
    );
    expect(res.status).toBe(400);
    expect(mocks.createWorkerJob).not.toHaveBeenCalled();
  });

  it('omits dispatch credentials in production unless explicitly enabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('COPILOT_WORKER_DISPATCH_CREDENTIALS', '');

    await POST(makeRequest({ type: 'topic-regeneration', input: {} }));

    const input = mocks.createWorkerJob.mock.calls[0][0];
    expect(input.credentials).toBeUndefined();
  });

  it('includes dispatch credentials in production when explicitly enabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('COPILOT_WORKER_DISPATCH_CREDENTIALS', '1');

    await POST(makeRequest({ type: 'topic-regeneration', input: {} }));

    const input = mocks.createWorkerJob.mock.calls[0][0];
    expect(input.credentials).toMatchObject({ accessToken: 'ghu_user' });
  });

  it('returns 503 when worker create throws', async () => {
    mocks.createWorkerJob.mockRejectedValue(new Error('worker down'));

    const res = await POST(makeRequest({ type: 'topic-regeneration', input: {} }));
    expect(res.status).toBe(503);
  });

  it('responds with the canonical minimal job shape', async () => {
    const res = await POST(makeRequest({ type: 'topic-regeneration', input: {} }));
    const body = await res.json();
    expect(body).toEqual({
      id: expect.any(String),
      type: 'topic-regeneration',
      status: 'pending',
      createdAt: '2026-05-23T01:00:00.000Z',
    });
  });
});

describe('GET /api/jobs (proxy)', () => {
  it('proxies to listWorkerJobs with userId and filters', async () => {
    mocks.listWorkerJobs.mockResolvedValue([{ id: 'j1', status: 'running' }]);
    const res = await GET(makeGetRequest('type=chat-response&status=running'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobs: [{ id: 'j1', status: 'running' }] });
    expect(mocks.listWorkerJobs).toHaveBeenCalledWith({
      userId: 'user-1',
      type: 'chat-response',
      status: 'running',
      traceContext: expect.objectContaining({ traceparent: expect.any(String) }),
    });
  });

  it('returns 503 when worker list throws', async () => {
    mocks.listWorkerJobs.mockRejectedValue(new Error('worker down'));
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(503);
  });
});

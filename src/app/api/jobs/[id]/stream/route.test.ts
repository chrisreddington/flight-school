import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUserContext: vi.fn(),
  jobsGet: vi.fn(),
  getCopilotWorkerConfig: vi.fn(),
  fetchImpl: vi.fn(),
  mergeTracePropagationHeaders: vi.fn(),
  handleUnauthorizedError: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireUserContext: mocks.requireUserContext,
}));

vi.mock('@/lib/api', () => ({
  handleUnauthorizedError: mocks.handleUnauthorizedError,
}));

vi.mock('@/lib/jobs', () => ({
  jobStorage: { get: mocks.jobsGet },
}));

vi.mock('@/lib/copilot/execution/config', () => ({
  getCopilotWorkerConfig: mocks.getCopilotWorkerConfig,
}));

vi.mock('@/lib/observability/context-propagation', () => ({
  mergeTracePropagationHeaders: mocks.mergeTracePropagationHeaders,
  captureTracePropagationHeaders: vi.fn(() => ({})),
}));

import { GET } from './route';

const origFetch = globalThis.fetch;

type RouteContext = { params: Promise<{ id: string }> };

function makeRequest(jobId: string, init: { cursor?: string } = {}) {
  const url = `http://localhost/api/jobs/${jobId}/stream${init.cursor !== undefined ? `?cursor=${init.cursor}` : ''}`;
  return new Request(url, { method: 'GET' }) as never;
}

function makeContext(id: string): RouteContext {
  return { params: Promise.resolve({ id }) };
}

describe('/api/jobs/[id]/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mocks.fetchImpl as unknown as typeof fetch;
    mocks.requireUserContext.mockResolvedValue({ userId: 'u1' });
    mocks.mergeTracePropagationHeaders.mockImplementation(
      (a: Record<string, string>, b: Record<string, string>) => ({ ...a, ...b }),
    );
    mocks.handleUnauthorizedError.mockReturnValue(new Response('401', { status: 401 }));
    mocks.getCopilotWorkerConfig.mockReturnValue({
      baseUrl: 'http://worker.local',
      secret: 'sec',
    });
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('returns 401 when unauthenticated', async () => {
    mocks.requireUserContext.mockRejectedValueOnce(new Error('unauth'));
    const res = await GET(makeRequest('j1'), makeContext('j1'));
    expect(res.status).toBe(401);
    expect(mocks.handleUnauthorizedError).toHaveBeenCalled();
  });

  it('returns 404 when the job is not owned by the user', async () => {
    mocks.jobsGet.mockResolvedValue({ id: 'j1', userId: 'someone-else' });
    const res = await GET(makeRequest('j1'), makeContext('j1'));
    expect(res.status).toBe(404);
  });

  it('returns 503 when the worker is not configured', async () => {
    mocks.jobsGet.mockResolvedValue({ id: 'j1', userId: 'u1' });
    mocks.getCopilotWorkerConfig.mockReturnValue(null);
    const res = await GET(makeRequest('j1'), makeContext('j1'));
    expect(res.status).toBe(503);
  });

  it('proxies the worker SSE stream on success', async () => {
    mocks.jobsGet.mockResolvedValue({ id: 'j1', userId: 'u1' });
    const upstreamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: hi\n\n'));
        controller.close();
      },
    });
    mocks.fetchImpl.mockResolvedValue(
      new Response(upstreamBody, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );

    const res = await GET(makeRequest('j1', { cursor: '5' }), makeContext('j1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');

    const calledUrl = mocks.fetchImpl.mock.calls[0][0] as string;
    expect(calledUrl).toBe('http://worker.local/api/internal/jobs/j1/stream?cursor=5');
    const calledInit = mocks.fetchImpl.mock.calls[0][1] as RequestInit;
    expect((calledInit.headers as Record<string, string>)['x-user-id']).toBe('u1');
    expect((calledInit.headers as Record<string, string>).authorization).toBe('Bearer sec');
  });

  it('returns 404 when worker reports the job missing', async () => {
    mocks.jobsGet.mockResolvedValue({ id: 'j1', userId: 'u1' });
    mocks.fetchImpl.mockResolvedValue(new Response(null, { status: 404 }));
    const res = await GET(makeRequest('j1'), makeContext('j1'));
    expect(res.status).toBe(404);
  });

  it('returns 502 when the worker is unreachable', async () => {
    mocks.jobsGet.mockResolvedValue({ id: 'j1', userId: 'u1' });
    mocks.fetchImpl.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const res = await GET(makeRequest('j1'), makeContext('j1'));
    expect(res.status).toBe(502);
  });
});

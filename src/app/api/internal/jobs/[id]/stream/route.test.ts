import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  withExtractedTraceContext: vi.fn(),
  jobsGet: vi.fn(),
  createJobStreamResponse: vi.fn(),
  createSynthesizedTerminalResponse: vi.fn(),
  hasBuffer: vi.fn(),
}));

vi.mock('@/lib/observability/context-propagation', () => ({
  withExtractedTraceContext: mocks.withExtractedTraceContext,
}));

vi.mock('@/lib/jobs', () => ({
  jobStorage: { get: mocks.jobsGet },
}));

vi.mock('@/worker/jobs/streaming/sse', () => ({
  createJobStreamResponse: mocks.createJobStreamResponse,
  createSynthesizedTerminalResponse: mocks.createSynthesizedTerminalResponse,
}));

vi.mock('@/worker/jobs/streaming/event-bus', () => ({
  jobEventBus: { hasBuffer: mocks.hasBuffer },
}));

import { GET } from './route';

type RouteContext = { params: Promise<{ id: string }> };

function makeRequest(
  jobId: string,
  init: { token?: string; userId?: string; cursor?: string; lastEventId?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
  if (init.userId !== undefined) headers['x-user-id'] = init.userId;
  if (init.lastEventId !== undefined) headers['last-event-id'] = init.lastEventId;
  const url = `http://localhost/api/internal/jobs/${jobId}/stream${init.cursor !== undefined ? `?cursor=${init.cursor}` : ''}`;
  return new Request(url, { method: 'GET', headers }) as never;
}

function makeContext(id: string): RouteContext {
  return { params: Promise.resolve({ id }) };
}

describe('/api/internal/jobs/[id]/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('COPILOT_WORKER_MODE', '1');
    vi.stubEnv('COPILOT_WORKER_SECRET', 'local-secret');
    mocks.withExtractedTraceContext.mockImplementation(
      async (_headers: unknown, op: () => unknown) => await op(),
    );
    mocks.createJobStreamResponse.mockReturnValue(new Response('ok', { status: 200 }));
    mocks.createSynthesizedTerminalResponse.mockReturnValue(new Response('synth', { status: 200 }));
    mocks.hasBuffer.mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 404 when worker mode is disabled', async () => {
    vi.stubEnv('COPILOT_WORKER_MODE', '0');
    const res = await GET(
      makeRequest('j1', { token: 'local-secret', userId: 'u1' }),
      makeContext('j1'),
    );
    expect(res.status).toBe(404);
  });

  it('returns 401 with wrong bearer', async () => {
    const res = await GET(
      makeRequest('j1', { token: 'bad', userId: 'u1' }),
      makeContext('j1'),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 without x-user-id', async () => {
    const res = await GET(makeRequest('j1', { token: 'local-secret' }), makeContext('j1'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when job is missing or not owned by user', async () => {
    mocks.jobsGet.mockResolvedValueOnce(null);
    const res1 = await GET(
      makeRequest('j1', { token: 'local-secret', userId: 'u1' }),
      makeContext('j1'),
    );
    expect(res1.status).toBe(404);

    mocks.jobsGet.mockResolvedValueOnce({ id: 'j1', userId: 'someone-else' });
    const res2 = await GET(
      makeRequest('j1', { token: 'local-secret', userId: 'u1' }),
      makeContext('j1'),
    );
    expect(res2.status).toBe(404);
  });

  it('delegates to createJobStreamResponse with parsed cursor', async () => {
    mocks.jobsGet.mockResolvedValue({ id: 'j1', userId: 'u1' });
    await GET(
      makeRequest('j1', { token: 'local-secret', userId: 'u1', cursor: '42' }),
      makeContext('j1'),
    );
    expect(mocks.createJobStreamResponse).toHaveBeenCalledWith(
      'j1',
      42,
      expect.any(AbortSignal),
    );
  });

  it('prefers larger Last-Event-ID over cursor', async () => {
    mocks.jobsGet.mockResolvedValue({ id: 'j1', userId: 'u1' });
    await GET(
      makeRequest('j1', { token: 'local-secret', userId: 'u1', cursor: '5', lastEventId: '17' }),
      makeContext('j1'),
    );
    expect(mocks.createJobStreamResponse).toHaveBeenCalledWith(
      'j1',
      17,
      expect.any(AbortSignal),
    );
  });

  it('synthesizes a terminal done frame when the job is completed and the bus buffer has been swept', async () => {
    mocks.jobsGet.mockResolvedValue({ id: 'j1', userId: 'u1', status: 'completed' });
    mocks.hasBuffer.mockReturnValue(false);
    await GET(
      makeRequest('j1', { token: 'local-secret', userId: 'u1' }),
      makeContext('j1'),
    );
    expect(mocks.createJobStreamResponse).not.toHaveBeenCalled();
    expect(mocks.createSynthesizedTerminalResponse).toHaveBeenCalledWith({ type: 'done' });
  });

  it('synthesizes a terminal failed frame with the stored error when the buffer was swept', async () => {
    mocks.jobsGet.mockResolvedValue({
      id: 'j1',
      userId: 'u1',
      status: 'failed',
      error: 'rate limited',
    });
    mocks.hasBuffer.mockReturnValue(false);
    await GET(
      makeRequest('j1', { token: 'local-secret', userId: 'u1' }),
      makeContext('j1'),
    );
    expect(mocks.createSynthesizedTerminalResponse).toHaveBeenCalledWith({
      type: 'failed',
      message: 'rate limited',
    });
  });

  it('synthesizes a cancelled frame when buffer was swept', async () => {
    mocks.jobsGet.mockResolvedValue({ id: 'j1', userId: 'u1', status: 'cancelled' });
    mocks.hasBuffer.mockReturnValue(false);
    await GET(
      makeRequest('j1', { token: 'local-secret', userId: 'u1' }),
      makeContext('j1'),
    );
    expect(mocks.createSynthesizedTerminalResponse).toHaveBeenCalledWith({ type: 'cancelled' });
  });

  it('does NOT synthesize when bus buffer still exists (use the live stream instead)', async () => {
    mocks.jobsGet.mockResolvedValue({ id: 'j1', userId: 'u1', status: 'completed' });
    mocks.hasBuffer.mockReturnValue(true);
    await GET(
      makeRequest('j1', { token: 'local-secret', userId: 'u1' }),
      makeContext('j1'),
    );
    expect(mocks.createSynthesizedTerminalResponse).not.toHaveBeenCalled();
    expect(mocks.createJobStreamResponse).toHaveBeenCalled();
  });
});

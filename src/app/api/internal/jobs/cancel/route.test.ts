import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requestCancellation: vi.fn(),
  withExtractedTraceContext: vi.fn(),
}));

vi.mock('@/worker/jobs/executors/session-registry', () => ({
  requestCancellation: mocks.requestCancellation,
}));

vi.mock('@/lib/observability/context-propagation', () => ({
  withExtractedTraceContext: mocks.withExtractedTraceContext,
}));

import { POST } from './route';

function makeRequest(body: unknown, token = 'local-secret') {
  return new Request('http://localhost/api/internal/jobs/cancel', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }) as never;
}

describe('/api/internal/jobs/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('COPILOT_WORKER_MODE', '1');
    vi.stubEnv('COPILOT_WORKER_SECRET', 'local-secret');
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

    const response = await POST(makeRequest({ jobId: 'job-1' }));

    expect(response.status).toBe(404);
    expect(mocks.requestCancellation).not.toHaveBeenCalled();
  });

  it('returns 401 when bearer auth is invalid', async () => {
    const response = await POST(makeRequest({ jobId: 'job-1' }, 'wrong-secret'));

    expect(response.status).toBe(401);
    expect(mocks.requestCancellation).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid requests', async () => {
    const response = await POST(makeRequest({}));

    expect(response.status).toBe(400);
    expect(mocks.requestCancellation).not.toHaveBeenCalled();
  });

  it('records cancellation intent when no session is currently registered', async () => {
    mocks.requestCancellation.mockResolvedValue(false);

    const response = await POST(makeRequest({ jobId: 'job-1' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ cancelled: false });
    expect(mocks.requestCancellation).toHaveBeenCalledWith('job-1');
  });

  it('destroys a registered session when present', async () => {
    mocks.requestCancellation.mockResolvedValue(true);

    const response = await POST(makeRequest({ jobId: 'job-1' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ cancelled: true });
    expect(mocks.requestCancellation).toHaveBeenCalledWith('job-1');
  });

  it('extracts trace context before cancellation handling', async () => {
    mocks.requestCancellation.mockResolvedValue(false);

    const response = await POST(makeRequest({ jobId: 'job-1' }));

    expect(response.status).toBe(200);
    expect(mocks.withExtractedTraceContext).toHaveBeenCalledTimes(1);
  });
});

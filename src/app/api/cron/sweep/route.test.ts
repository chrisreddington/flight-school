import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  verifyCronRequestMock,
  sweepAllUsersMock,
  sweepWorkerJobsMock,
  captureTraceMock,
  CronAuthErrorMock,
} = vi.hoisted(() => {
  class CronAuthErrorMock extends Error {
    readonly status: number;
    constructor(message: string, status = 401) {
      super(message);
      this.name = 'CronAuthError';
      this.status = status;
    }
  }

  return {
    verifyCronRequestMock: vi.fn(),
    sweepAllUsersMock: vi.fn(),
    sweepWorkerJobsMock: vi.fn(),
    captureTraceMock: vi.fn(),
    CronAuthErrorMock,
  };
});

vi.mock('@/lib/security/cron-auth', () => ({
  verifyCronRequest: verifyCronRequestMock,
  CronAuthError: CronAuthErrorMock,
}));

vi.mock('@/lib/storage/user-retention', () => ({
  sweepAllUsers: sweepAllUsersMock,
}));

vi.mock('@/app/api/jobs/worker-client', () => ({
  sweepWorkerJobs: sweepWorkerJobsMock,
}));

vi.mock('@/lib/observability/context-propagation', () => ({
  captureTracePropagationHeaders: captureTraceMock,
}));

import { POST } from './route';

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://example.invalid/api/cron/sweep', {
    method: 'POST',
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyCronRequestMock.mockResolvedValue({ appid: 'cron-app' });
  sweepAllUsersMock.mockResolvedValue({ threads: 2, evaluations: 3, scratchpads: 1 });
  sweepWorkerJobsMock.mockResolvedValue({
    staleRunningJobs: 4,
    orphanJobs: 5,
    redactedTerminalJobs: 6,
  });
  captureTraceMock.mockReturnValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/cron/sweep', () => {
  it('returns 401 when cron auth rejects the request', async () => {
    verifyCronRequestMock.mockRejectedValue(new CronAuthErrorMock('Missing bearer token'));

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Missing bearer token' });
    expect(sweepAllUsersMock).not.toHaveBeenCalled();
  });

  it('returns aggregate sweep counts when auth succeeds', async () => {
    const response = await POST(makeRequest({ authorization: 'Bearer token' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(verifyCronRequestMock).toHaveBeenCalledTimes(1);
    expect(sweepAllUsersMock).toHaveBeenCalledTimes(1);
    expect(sweepWorkerJobsMock).toHaveBeenCalledTimes(1);

    expect(body.success).toBe(true);
    expect(body.summary).toMatchObject({
      threads: 2,
      evaluations: 3,
      scratchpads: 1,
      staleRunningJobs: 4,
      orphanJobs: 5,
      redactedTerminalJobs: 6,
    });
    expect(typeof body.sweptAt).toBe('string');
  });

  it('returns 207 partial-success when one sweep step throws', async () => {
    sweepAllUsersMock.mockRejectedValue(new Error('storage offline'));

    const response = await POST(makeRequest({ authorization: 'Bearer token' }));
    const body = await response.json();

    expect(response.status).toBe(207);
    expect(body.success).toBe(false);
    expect(body.steps).toEqual({ userSweep: 'rejected', jobSweep: 'fulfilled' });
    expect(body.summary.threads).toBeNull();
    expect(body.summary.staleRunningJobs).toBe(4);
  });

  it('still returns 500 on unexpected non-auth errors (e.g. trace capture throws)', async () => {
    captureTraceMock.mockImplementation(() => {
      throw new Error('telemetry exploded');
    });

    const response = await POST(makeRequest({ authorization: 'Bearer token' }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Internal error' });
  });
});

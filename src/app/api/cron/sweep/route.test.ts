import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  verifyCronRequestMock,
  sweepAllUsersMock,
  sweepStaleRunningJobsMock,
  sweepOrphanJobsMock,
  redactTerminalJobsMock,
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
    sweepStaleRunningJobsMock: vi.fn(),
    sweepOrphanJobsMock: vi.fn(),
    redactTerminalJobsMock: vi.fn(),
    CronAuthErrorMock,
  };
});

vi.mock('@/lib/security/cron-auth', () => ({
  verifyCronRequest: verifyCronRequestMock,
  CronAuthError: CronAuthErrorMock,
}));

vi.mock('@/lib/storage/retention', () => ({
  sweepAllUsers: sweepAllUsersMock,
  sweepStaleRunningJobs: sweepStaleRunningJobsMock,
  sweepOrphanJobs: sweepOrphanJobsMock,
  redactTerminalJobs: redactTerminalJobsMock,
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
  sweepStaleRunningJobsMock.mockResolvedValue(4);
  sweepOrphanJobsMock.mockResolvedValue(5);
  redactTerminalJobsMock.mockResolvedValue(6);
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
    expect(sweepStaleRunningJobsMock).toHaveBeenCalledTimes(1);
    expect(sweepOrphanJobsMock).toHaveBeenCalledTimes(1);
    expect(redactTerminalJobsMock).toHaveBeenCalledTimes(1);

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

  it('returns 500 when a sweep step throws unexpectedly', async () => {
    sweepAllUsersMock.mockRejectedValue(new Error('storage offline'));

    const response = await POST(makeRequest({ authorization: 'Bearer token' }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Internal error' });
  });
});

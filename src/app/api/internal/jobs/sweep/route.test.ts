import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sweepStaleRunningJobs: vi.fn(),
  sweepOrphanJobs: vi.fn(),
  redactTerminalJobs: vi.fn(),
  withExtractedTraceContext: vi.fn(),
}));

vi.mock('@/worker/jobs/retention', () => ({
  sweepStaleRunningJobs: mocks.sweepStaleRunningJobs,
  sweepOrphanJobs: mocks.sweepOrphanJobs,
  redactTerminalJobs: mocks.redactTerminalJobs,
}));

vi.mock('@/lib/observability/context-propagation', () => ({
  withExtractedTraceContext: mocks.withExtractedTraceContext,
}));

import { POST } from './route';

function makeRequest(body?: unknown, token = 'local-secret') {
  const init: RequestInit = {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request('http://localhost/api/internal/jobs/sweep', init) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('COPILOT_WORKER_MODE', '1');
  vi.stubEnv('COPILOT_WORKER_SECRET', 'local-secret');
  mocks.withExtractedTraceContext.mockImplementation(
    async (_h: unknown, op: () => unknown) => op(),
  );
  mocks.sweepStaleRunningJobs.mockResolvedValue({ deleted: 1, inspected: 2 });
  mocks.sweepOrphanJobs.mockResolvedValue({ deleted: 0, inspected: 3 });
  mocks.redactTerminalJobs.mockResolvedValue({ deleted: 4, inspected: 5 });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/internal/jobs/sweep', () => {
  it('requires auth', async () => {
    const res = await POST(makeRequest({}, 'nope'));
    expect(res.status).toBe(401);
  });

  it('returns aggregate summary', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      staleRunningJobs: { deleted: 1, inspected: 2 },
      orphanJobs: { deleted: 0, inspected: 3 },
      redactedTerminalJobs: { deleted: 4, inspected: 5 },
    });
  });

  it('forwards nowMs to sweepStaleRunningJobs', async () => {
    const res = await POST(makeRequest({ nowMs: 1_700_000_000_000 }));
    expect(res.status).toBe(200);
    expect(mocks.sweepStaleRunningJobs).toHaveBeenCalledWith(1_700_000_000_000);
  });
});

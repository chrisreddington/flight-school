import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  jobStorageGetAll: vi.fn(),
  jobStorageDeleteForUser: vi.fn(),
  jobStorageMarkCancelled: vi.fn(),
  requestCancellation: vi.fn(),
  withExtractedTraceContext: vi.fn(),
}));

vi.mock('@/lib/jobs', () => ({
  jobStorage: {
    getAll: mocks.jobStorageGetAll,
    deleteForUser: mocks.jobStorageDeleteForUser,
    markCancelled: mocks.jobStorageMarkCancelled,
  },
}));

vi.mock('@/worker/jobs/executors/session-registry', () => ({
  requestCancellation: mocks.requestCancellation,
}));

vi.mock('@/lib/observability/context-propagation', () => ({
  withExtractedTraceContext: mocks.withExtractedTraceContext,
}));

import { DELETE, GET } from './route';

function makeRequest(method: 'GET' | 'DELETE', query = '', token = 'local-secret') {
  return new Request(`http://localhost/api/internal/jobs/user-data?${query}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('COPILOT_WORKER_MODE', '1');
  vi.stubEnv('COPILOT_WORKER_SECRET', 'local-secret');
  mocks.withExtractedTraceContext.mockImplementation(
    async (_h: unknown, op: () => unknown) => op(),
  );
  mocks.jobStorageGetAll.mockResolvedValue([
    { id: 'a', userId: 'u-1', status: 'completed' },
    { id: 'b', userId: 'u-2', status: 'running' },
    { id: 'c', userId: 'u-1', status: 'running' },
    { id: 'd', userId: 'u-1', status: 'pending' },
  ]);
  mocks.jobStorageDeleteForUser.mockResolvedValue({ deleted: 3, ids: ['a', 'c', 'd'] });
  mocks.jobStorageMarkCancelled.mockResolvedValue(undefined);
  mocks.requestCancellation.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/internal/jobs/user-data', () => {
  it('requires userId', async () => {
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(400);
  });

  it('filters by userId', async () => {
    const res = await GET(makeRequest('GET', 'userId=u-1'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.jobs.map((j: { id: string }) => j.id)).toEqual(['a', 'c', 'd']);
  });
});

describe('DELETE /api/internal/jobs/user-data', () => {
  it('requires userId', async () => {
    const res = await DELETE(makeRequest('DELETE'));
    expect(res.status).toBe(400);
  });

  it('cancels in-flight jobs then deletes records and returns both counts', async () => {
    const res = await DELETE(makeRequest('DELETE', 'userId=u-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 3, cancelled: 2 });
    // Only running + pending jobs owned by u-1 are cancelled (c, d). a is completed.
    expect(mocks.jobStorageMarkCancelled).toHaveBeenCalledTimes(2);
    expect(mocks.jobStorageMarkCancelled).toHaveBeenCalledWith('c');
    expect(mocks.jobStorageMarkCancelled).toHaveBeenCalledWith('d');
    expect(mocks.requestCancellation).toHaveBeenCalledTimes(2);
    expect(mocks.jobStorageDeleteForUser).toHaveBeenCalledWith('u-1');
  });

  it('marks cancelled before requesting cancellation for each in-flight job', async () => {
    const order: string[] = [];
    mocks.jobStorageMarkCancelled.mockImplementation(async (id: string) => { order.push(`mark:${id}`); });
    mocks.requestCancellation.mockImplementation(async (id: string) => { order.push(`req:${id}`); return true; });
    await DELETE(makeRequest('DELETE', 'userId=u-1'));
    expect(order).toEqual(['mark:c', 'req:c', 'mark:d', 'req:d']);
  });

  it('continues deletion even when a per-job cancel throws', async () => {
    mocks.requestCancellation.mockImplementationOnce(async () => { throw new Error('boom'); });
    const res = await DELETE(makeRequest('DELETE', 'userId=u-1'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(3);
    expect(mocks.jobStorageDeleteForUser).toHaveBeenCalledWith('u-1');
  });
});

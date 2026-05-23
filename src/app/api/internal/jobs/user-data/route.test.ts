import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  jobStorageGetAll: vi.fn(),
  jobStorageDeleteForUser: vi.fn(),
  jobStorageMarkCancelledIfNonTerminal: vi.fn(),
  requestCancellation: vi.fn(),
  appendTerminalIfNotTerminated: vi.fn(),
  withExtractedTraceContext: vi.fn(),
}));

vi.mock('@/lib/jobs', () => ({
  jobStorage: {
    getAll: mocks.jobStorageGetAll,
    deleteForUser: mocks.jobStorageDeleteForUser,
    markCancelledIfNonTerminal: mocks.jobStorageMarkCancelledIfNonTerminal,
  },
}));

vi.mock('@/worker/jobs/executors/session-registry', () => ({
  requestCancellation: mocks.requestCancellation,
}));

vi.mock('@/worker/jobs/streaming/event-bus', () => ({
  jobEventBus: {
    appendTerminalIfNotTerminated: mocks.appendTerminalIfNotTerminated,
  },
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
  mocks.jobStorageMarkCancelledIfNonTerminal.mockResolvedValue({ status: 'cancelled', transitioned: true });
  mocks.requestCancellation.mockResolvedValue(true);
  mocks.appendTerminalIfNotTerminated.mockReturnValue(undefined);
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
    expect(mocks.jobStorageMarkCancelledIfNonTerminal).toHaveBeenCalledTimes(2);
    expect(mocks.jobStorageMarkCancelledIfNonTerminal).toHaveBeenCalledWith('c');
    expect(mocks.jobStorageMarkCancelledIfNonTerminal).toHaveBeenCalledWith('d');
    expect(mocks.requestCancellation).toHaveBeenCalledTimes(2);
    expect(mocks.jobStorageDeleteForUser).toHaveBeenCalledWith('u-1');
  });

  it('marks cancelled before requesting cancellation for each in-flight job', async () => {
    const order: string[] = [];
    mocks.jobStorageMarkCancelledIfNonTerminal.mockImplementation(async (id: string) => {
      order.push(`mark:${id}`);
      return { status: 'cancelled', transitioned: true };
    });
    mocks.requestCancellation.mockImplementation(async (id: string) => { order.push(`req:${id}`); return true; });
    await DELETE(makeRequest('DELETE', 'userId=u-1'));
    expect(order).toEqual(['mark:c', 'req:c', 'mark:d', 'req:d']);
  });

  it('emits a synthesized cancelled terminal for orphan in-flight jobs (no active session)', async () => {
    mocks.requestCancellation.mockResolvedValue(false);
    const res = await DELETE(makeRequest('DELETE', 'userId=u-1'));
    expect(res.status).toBe(200);
    // Both running/pending jobs lacked an active session — both should
    // get a synthesized cancelled terminal so any SSE consumers unstick.
    expect(mocks.appendTerminalIfNotTerminated).toHaveBeenCalledTimes(2);
    expect(mocks.appendTerminalIfNotTerminated).toHaveBeenCalledWith('c', {
      type: 'cancelled',
      content: '',
      toolEvents: [],
    });
    expect(mocks.appendTerminalIfNotTerminated).toHaveBeenCalledWith('d', {
      type: 'cancelled',
      content: '',
      toolEvents: [],
    });
  });

  it('does not emit synthesized cancelled when the executor session is still active', async () => {
    mocks.requestCancellation.mockResolvedValue(true);
    await DELETE(makeRequest('DELETE', 'userId=u-1'));
    // Executor owns the terminal frame; do NOT race it from the route.
    expect(mocks.appendTerminalIfNotTerminated).not.toHaveBeenCalled();
  });

  it('skips already-terminal jobs (CAS reports no transition)', async () => {
    mocks.jobStorageMarkCancelledIfNonTerminal.mockResolvedValue({
      status: 'cancelled',
      transitioned: false,
    });
    const res = await DELETE(makeRequest('DELETE', 'userId=u-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 3, cancelled: 0 });
    expect(mocks.requestCancellation).not.toHaveBeenCalled();
    expect(mocks.appendTerminalIfNotTerminated).not.toHaveBeenCalled();
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

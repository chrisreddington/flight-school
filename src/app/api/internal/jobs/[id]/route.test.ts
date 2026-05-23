import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  jobStorageGet: vi.fn(),
  jobStorageMarkCancelled: vi.fn(),
  jobStorageMarkCancelledIfNonTerminal: vi.fn(),
  jobStorageInvalidateCache: vi.fn(),
  requestCancellation: vi.fn(),
  appendTerminalIfNotTerminated: vi.fn(),
  withExtractedTraceContext: vi.fn(),
}));

vi.mock('@/lib/jobs', () => ({
  jobStorage: {
    get: mocks.jobStorageGet,
    markCancelled: mocks.jobStorageMarkCancelled,
    markCancelledIfNonTerminal: mocks.jobStorageMarkCancelledIfNonTerminal,
    invalidateCache: mocks.jobStorageInvalidateCache,
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
  return new Request(`http://localhost/api/internal/jobs/job-1?${query}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
  }) as never;
}

function params(id = 'job-1') {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('COPILOT_WORKER_MODE', '1');
  vi.stubEnv('COPILOT_WORKER_SECRET', 'local-secret');
  mocks.withExtractedTraceContext.mockImplementation(
    async (_h: unknown, op: () => unknown) => op(),
  );
  mocks.requestCancellation.mockResolvedValue(true);
  mocks.jobStorageMarkCancelled.mockResolvedValue({});
  mocks.jobStorageMarkCancelledIfNonTerminal.mockResolvedValue({ status: 'cancelled', transitioned: true });
  mocks.appendTerminalIfNotTerminated.mockReturnValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/internal/jobs/[id]', () => {
  it('returns 400 without userId', async () => {
    const res = await GET(makeRequest('GET'), params());
    expect(res.status).toBe(400);
  });

  it('returns 404 when job is missing', async () => {
    mocks.jobStorageGet.mockResolvedValue(undefined);
    const res = await GET(makeRequest('GET', 'userId=u-1'), params());
    expect(res.status).toBe(404);
  });

  it('returns 404 when ownership does not match', async () => {
    mocks.jobStorageGet.mockResolvedValue({ id: 'job-1', userId: 'other', status: 'running', input: {}, type: 'chat-response', createdAt: 'x' });
    const res = await GET(makeRequest('GET', 'userId=u-1'), params());
    expect(res.status).toBe(404);
  });

  it('returns redacted detail on success', async () => {
    mocks.jobStorageGet.mockResolvedValue({
      id: 'job-1', userId: 'u-1', status: 'running', type: 'chat-response',
      input: { prompt: 'secret' }, createdAt: 'x',
    });
    const res = await GET(makeRequest('GET', 'userId=u-1'), params());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('job-1');
    expect(json.input).toBeDefined();
  });
});

describe('DELETE /api/internal/jobs/[id]', () => {
  it('returns 400 without userId', async () => {
    const res = await DELETE(makeRequest('DELETE'), params());
    expect(res.status).toBe(400);
  });

  it('returns 404 when ownership mismatches (multi-tenant)', async () => {
    mocks.jobStorageGet.mockResolvedValue({ id: 'job-1', userId: 'other', status: 'running', input: {}, type: 'chat-response', createdAt: 'x' });
    const res = await DELETE(makeRequest('DELETE', 'userId=u-1'), params());
    expect(res.status).toBe(404);
    expect(mocks.requestCancellation).not.toHaveBeenCalled();
    expect(mocks.jobStorageMarkCancelledIfNonTerminal).not.toHaveBeenCalled();
  });

  it('returns alreadyTerminal=true without cancelling when job is terminal', async () => {
    mocks.jobStorageGet.mockResolvedValue({ id: 'job-1', userId: 'u-1', status: 'completed', input: {}, type: 'chat-response', createdAt: 'x' });
    const res = await DELETE(makeRequest('DELETE', 'userId=u-1'), params());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ alreadyTerminal: true, status: 'completed' });
    expect(mocks.requestCancellation).not.toHaveBeenCalled();
    expect(mocks.jobStorageMarkCancelledIfNonTerminal).not.toHaveBeenCalled();
  });

  it('invokes abort helper and marks cancelled (active session — no orphan emit)', async () => {
    mocks.jobStorageGet.mockResolvedValue({ id: 'job-1', userId: 'u-1', status: 'running', input: {}, type: 'chat-response', createdAt: 'x' });
    mocks.requestCancellation.mockResolvedValue(true);
    const res = await DELETE(makeRequest('DELETE', 'userId=u-1'), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cancelled: true, orphan: false });
    expect(mocks.requestCancellation).toHaveBeenCalledWith('job-1');
    expect(mocks.jobStorageMarkCancelledIfNonTerminal).toHaveBeenCalledWith('job-1');
    // Worker's terminal sequence owns the SSE emit when a session was live.
    expect(mocks.appendTerminalIfNotTerminated).not.toHaveBeenCalled();
  });

  it('emits orphan cancelled SSE frame when no active session was registered', async () => {
    mocks.jobStorageGet.mockResolvedValue({ id: 'job-1', userId: 'u-1', status: 'running', input: {}, type: 'chat-response', createdAt: 'x' });
    mocks.requestCancellation.mockResolvedValue(false);
    const res = await DELETE(makeRequest('DELETE', 'userId=u-1'), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cancelled: true, orphan: true });
    expect(mocks.appendTerminalIfNotTerminated).toHaveBeenCalledWith('job-1', {
      type: 'cancelled',
      content: '',
      toolEvents: [],
    });
  });

  it('returns alreadyTerminal when CAS detects the job has already settled (race with worker)', async () => {
    mocks.jobStorageGet.mockResolvedValue({ id: 'job-1', userId: 'u-1', status: 'running', input: {}, type: 'chat-response', createdAt: 'x' });
    mocks.jobStorageMarkCancelledIfNonTerminal.mockResolvedValue({ status: 'completed', transitioned: false });
    const res = await DELETE(makeRequest('DELETE', 'userId=u-1'), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ alreadyTerminal: true, status: 'completed' });
    expect(mocks.requestCancellation).not.toHaveBeenCalled();
    expect(mocks.appendTerminalIfNotTerminated).not.toHaveBeenCalled();
  });

  it('CAS markCancelledIfNonTerminal runs BEFORE requestCancellation so executor sees terminal intent first', async () => {
    mocks.jobStorageGet.mockResolvedValue({ id: 'job-1', userId: 'u-1', status: 'running', input: {}, type: 'chat-response', createdAt: 'x' });
    const order: string[] = [];
    mocks.jobStorageMarkCancelledIfNonTerminal.mockImplementation(async () => {
      order.push('markCancelledIfNonTerminal');
      return { status: 'cancelled', transitioned: true };
    });
    mocks.requestCancellation.mockImplementation(async () => { order.push('requestCancellation'); return true; });
    const res = await DELETE(makeRequest('DELETE', 'userId=u-1'), params());
    expect(res.status).toBe(200);
    expect(order).toEqual(['markCancelledIfNonTerminal', 'requestCancellation']);
  });
});

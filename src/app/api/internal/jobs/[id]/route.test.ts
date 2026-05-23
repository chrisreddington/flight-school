import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  jobStorageGet: vi.fn(),
  jobStorageMarkCancelled: vi.fn(),
  jobStorageInvalidateCache: vi.fn(),
  requestCancellation: vi.fn(),
  withExtractedTraceContext: vi.fn(),
}));

vi.mock('@/lib/jobs', () => ({
  jobStorage: {
    get: mocks.jobStorageGet,
    markCancelled: mocks.jobStorageMarkCancelled,
    invalidateCache: mocks.jobStorageInvalidateCache,
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
    expect(mocks.jobStorageMarkCancelled).not.toHaveBeenCalled();
  });

  it('returns alreadyTerminal=true without cancelling when job is terminal', async () => {
    mocks.jobStorageGet.mockResolvedValue({ id: 'job-1', userId: 'u-1', status: 'completed', input: {}, type: 'chat-response', createdAt: 'x' });
    const res = await DELETE(makeRequest('DELETE', 'userId=u-1'), params());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ alreadyTerminal: true, status: 'completed' });
    expect(mocks.requestCancellation).not.toHaveBeenCalled();
    expect(mocks.jobStorageMarkCancelled).not.toHaveBeenCalled();
  });

  it('invokes abort helper and marks cancelled', async () => {
    mocks.jobStorageGet.mockResolvedValue({ id: 'job-1', userId: 'u-1', status: 'running', input: {}, type: 'chat-response', createdAt: 'x' });
    const res = await DELETE(makeRequest('DELETE', 'userId=u-1'), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cancelled: true });
    expect(mocks.requestCancellation).toHaveBeenCalledWith('job-1');
    expect(mocks.jobStorageMarkCancelled).toHaveBeenCalledWith('job-1');
  });

  it('marks cancelled BEFORE requesting cancellation so executor sees terminal intent first', async () => {
    mocks.jobStorageGet.mockResolvedValue({ id: 'job-1', userId: 'u-1', status: 'running', input: {}, type: 'chat-response', createdAt: 'x' });
    const order: string[] = [];
    mocks.jobStorageMarkCancelled.mockImplementation(async () => { order.push('markCancelled'); });
    mocks.requestCancellation.mockImplementation(async () => { order.push('requestCancellation'); return true; });
    const res = await DELETE(makeRequest('DELETE', 'userId=u-1'), params());
    expect(res.status).toBe(200);
    expect(order).toEqual(['markCancelled', 'requestCancellation']);
  });
});

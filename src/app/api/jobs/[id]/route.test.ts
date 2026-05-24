import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUserContext: vi.fn(),
  getWorkerJob: vi.fn(),
  cancelWorkerJobRecord: vi.fn(),
  captureTracePropagationHeaders: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireUserContext: mocks.requireUserContext,
  UnauthorizedError: class extends Error {},
}));

vi.mock('@/lib/observability/context-propagation', () => ({
  captureTracePropagationHeaders: mocks.captureTracePropagationHeaders,
}));

vi.mock('./../worker-client', () => ({
  getWorkerJob: mocks.getWorkerJob,
  cancelWorkerJobRecord: mocks.cancelWorkerJobRecord,
}));

import { DELETE, GET } from './route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUserContext.mockResolvedValue({ userId: 'u-1' });
  mocks.captureTracePropagationHeaders.mockReturnValue({});
});

describe('GET /api/jobs/[id] (proxy)', () => {
  it('returns 404 when worker reports not found', async () => {
    mocks.getWorkerJob.mockResolvedValue(null);
    const res = await GET(new Request('http://localhost') as never, ctx('j1'));
    expect(res.status).toBe(404);
  });

  it('returns the redacted job on success', async () => {
    mocks.getWorkerJob.mockResolvedValue({ id: 'j1', status: 'running' });
    const res = await GET(new Request('http://localhost') as never, ctx('j1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'j1', status: 'running' });
    expect(mocks.getWorkerJob).toHaveBeenCalledWith('j1', 'u-1', undefined);
  });

  it('returns 503 when the worker call throws', async () => {
    mocks.getWorkerJob.mockRejectedValue(new Error('worker down'));
    const res = await GET(new Request('http://localhost') as never, ctx('j1'));
    expect(res.status).toBe(503);
  });
});

describe('DELETE /api/jobs/[id] (proxy)', () => {
  it('reports cancelled=true on a successful cancel', async () => {
    mocks.cancelWorkerJobRecord.mockResolvedValue({ cancelled: true });
    const res = await DELETE(new Request('http://localhost') as never, ctx('j1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      cancelled: true,
      deletedFromStorage: false,
    });
  });

  it('reports alreadyTerminal when the job had already finished', async () => {
    mocks.cancelWorkerJobRecord.mockResolvedValue({
      cancelled: false,
      alreadyTerminal: true,
      status: 'completed',
    });
    const res = await DELETE(new Request('http://localhost') as never, ctx('j1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      cancelled: false,
      deletedFromStorage: false,
      alreadyTerminal: true,
      status: 'completed',
    });
  });

  it('returns 404 when the worker reports the job missing or not owned', async () => {
    mocks.cancelWorkerJobRecord.mockResolvedValue({ cancelled: false, notFound: true });
    const res = await DELETE(new Request('http://localhost') as never, ctx('j1'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Job not found' });
  });

  it('returns 503 when the worker call throws', async () => {
    mocks.cancelWorkerJobRecord.mockRejectedValue(new Error('worker down'));
    const res = await DELETE(new Request('http://localhost') as never, ctx('j1'));
    expect(res.status).toBe(503);
  });
});

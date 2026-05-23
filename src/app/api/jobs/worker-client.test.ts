import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cancelWorkerJob,
  cancelWorkerJobRecord,
  createWorkerJob,
  deleteWorkerJobsForUser,
  dispatchJobExecutionToWorker,
  exportWorkerJobsForUser,
  getWorkerJob,
  listWorkerJobs,
  sweepWorkerJobs,
} from './worker-client';

const mocks = vi.hoisted(() => ({
  getCopilotWorkerConfig: vi.fn(),
}));

vi.mock('@/lib/copilot/execution/config', () => ({
  getCopilotWorkerConfig: mocks.getCopilotWorkerConfig,
}));

describe('worker-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    mocks.getCopilotWorkerConfig.mockReturnValue({
      baseUrl: 'http://localhost:3001',
      secret: 'worker-secret',
      timeoutMs: 120_000,
    });
  });

  it('posts dispatch requests to worker execute endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 202 }));

    await dispatchJobExecutionToWorker({
      jobId: 'job-1',
      type: 'chat-response',
      input: { threadId: 'thread-1', prompt: 'hello' },
      userId: 'user-1',
      credentials: {
        accessToken: 'ghu_user',
        refreshToken: 'ghr_user',
        expiresAt: 1_700_000_000,
      },
      traceContext: {
        traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
        tracestate: 'vendor=value',
      },
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/internal/jobs/execute',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer worker-secret',
          traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
          tracestate: 'vendor=value',
        }),
        body: expect.stringContaining('"jobId":"job-1"'),
      }),
    );

    const call = vi.mocked(fetch).mock.calls[0];
    const payload = JSON.parse(String((call?.[1] as RequestInit | undefined)?.body)) as Record<string, unknown>;
    expect(payload).not.toHaveProperty('traceContext');
  });

  it('posts cancel requests to worker cancel endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }));

    await cancelWorkerJob('job-1');

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/internal/jobs/cancel',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer worker-secret' }),
        body: JSON.stringify({ jobId: 'job-1' }),
      }),
    );
  });

  it('throws safe errors without echoing credential values', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'bad ghu_user' }), { status: 500 }),
    );

    await expect(
      dispatchJobExecutionToWorker({
        jobId: 'job-1',
        type: 'chat-response',
        input: { threadId: 'thread-1', prompt: 'hello' },
        userId: 'user-1',
        credentials: {
          accessToken: 'ghu_user',
          refreshToken: 'ghr_user',
          expiresAt: 1_700_000_000,
        },
      }),
    ).rejects.toThrow('Copilot worker job dispatch failed with HTTP 500');
  });

  describe('createWorkerJob', () => {
    it('POSTs to /api/internal/jobs and returns the created record', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ id: 'job-1', status: 'pending' }), { status: 202 }),
      );

      const result = await createWorkerJob({
        id: 'job-1',
        type: 'chat-response',
        userId: 'u-1',
        input: { threadId: 't', prompt: 'hi' },
      });

      expect(result).toMatchObject({ id: 'job-1' });
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/internal/jobs',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ authorization: 'Bearer worker-secret' }),
        }),
      );
      const call = vi.mocked(fetch).mock.calls[0];
      const payload = JSON.parse(String((call?.[1] as RequestInit | undefined)?.body));
      expect(payload).not.toHaveProperty('traceContext');
    });

    it('forwards traceparent/tracestate to the worker', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ id: 'job-1', status: 'pending' }), { status: 202 }),
      );

      await createWorkerJob({
        id: 'job-1',
        type: 'chat-response',
        userId: 'u-1',
        input: { threadId: 't', prompt: 'hi' },
        traceContext: {
          traceparent: '00-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-cccccccccccccccc-01',
          tracestate: 'vendor=value',
        },
      });

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/internal/jobs',
        expect.objectContaining({
          headers: expect.objectContaining({
            traceparent: '00-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-cccccccccccccccc-01',
            tracestate: 'vendor=value',
          }),
        }),
      );
      const call = vi.mocked(fetch).mock.calls[0];
      const payload = JSON.parse(String((call?.[1] as RequestInit | undefined)?.body));
      expect(payload).not.toHaveProperty('traceContext');
    });

    it('returns the existing record on 200 (idempotent replay)', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ id: 'job-1', status: 'running' }), { status: 200 }),
      );

      const result = await createWorkerJob({
        id: 'job-1', type: 'chat-response', userId: 'u-1', input: { prompt: 'hi' },
      });
      expect(result.id).toBe('job-1');
    });

    it('throws on non-OK responses', async () => {
      vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 500 }));
      await expect(
        createWorkerJob({ id: 'job-1', type: 'chat-response', userId: 'u-1', input: {} as never }),
      ).rejects.toThrow(/HTTP 500/);
    });
  });

  describe('listWorkerJobs', () => {
    it('passes userId/type/status as query params', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ jobs: [{ id: 'a' }] }), { status: 200 }),
      );

      const result = await listWorkerJobs({ userId: 'u-1', type: 'chat-response', status: 'running' });
      expect(result).toEqual([{ id: 'a' }]);
      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain('userId=u-1');
      expect(url).toContain('type=chat-response');
      expect(url).toContain('status=running');
    });
  });

  describe('getWorkerJob', () => {
    it('returns null on 404', async () => {
      vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 404 }));
      const result = await getWorkerJob('job-1', 'u-1');
      expect(result).toBeNull();
    });

    it('returns parsed body on success', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ id: 'job-1', status: 'running' }), { status: 200 }),
      );
      const result = await getWorkerJob('job-1', 'u-1');
      expect(result).toMatchObject({ id: 'job-1' });
    });
  });

  describe('cancelWorkerJobRecord', () => {
    it('DELETEs the job and returns the result body', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ cancelled: true }), { status: 200 }),
      );
      const result = await cancelWorkerJobRecord('job-1', 'u-1');
      expect(result).toEqual({ cancelled: true });
      expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
    });
  });

  describe('sweepWorkerJobs', () => {
    it('POSTs an optional nowMs body and returns counts', async () => {
      const summary = {
        staleRunningJobs: { deleted: 0, inspected: 0 },
        orphanJobs: { deleted: 1, inspected: 1 },
        redactedTerminalJobs: { deleted: 2, inspected: 3 },
      };
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(summary), { status: 200 }));

      const result = await sweepWorkerJobs({ nowMs: 1234 });
      expect(result).toEqual(summary);
      const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual({ nowMs: 1234 });
    });
  });

  describe('user-data endpoints', () => {
    it('exportWorkerJobsForUser returns the jobs array', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ jobs: [{ id: 'a' }, { id: 'b' }] }), { status: 200 }),
      );
      const jobs = await exportWorkerJobsForUser('u-1');
      expect(jobs).toHaveLength(2);
      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain('/api/internal/jobs/user-data');
      expect(url).toContain('userId=u-1');
    });

    it('deleteWorkerJobsForUser returns deleted and cancelled counts', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ deleted: 3, cancelled: 1 }), { status: 200 }),
      );
      const result = await deleteWorkerJobsForUser('u-1');
      expect(result).toEqual({ deleted: 3, cancelled: 1 });
      expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
    });
  });
});

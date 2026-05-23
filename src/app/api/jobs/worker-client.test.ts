import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cancelWorkerJob, dispatchJobExecutionToWorker } from './worker-client';

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
});

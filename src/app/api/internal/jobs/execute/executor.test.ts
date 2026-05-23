import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startSpan: vi.fn(),
  setSpan: vi.fn(),
  contextWith: vi.fn(),
  executeWorkerJob: vi.fn(),
  markFailed: vi.fn(),
  recordJobQueueWait: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@opentelemetry/api', () => ({
  context: {
    active: vi.fn(() => ({})),
    with: mocks.contextWith,
  },
  trace: {
    getTracer: vi.fn(() => ({
      startSpan: mocks.startSpan,
    })),
    setSpan: mocks.setSpan,
  },
}));

vi.mock('@/worker/jobs/executor-dispatcher', () => ({
  executeWorkerJob: mocks.executeWorkerJob,
}));

vi.mock('@/lib/jobs', () => ({
  jobStorage: {
    markFailed: mocks.markFailed,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    withTag: vi.fn(() => ({
      error: mocks.loggerError,
    })),
  },
}));

vi.mock('@/lib/observability/telemetry', () => ({
  recordJobQueueWait: mocks.recordJobQueueWait,
}));

import { scheduleWorkerJobExecution } from './executor';

describe('scheduleWorkerJobExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeWorkerJob.mockResolvedValue(undefined);
    mocks.setSpan.mockReturnValue({});
    mocks.contextWith.mockImplementation(async (_ctx: unknown, callback: () => unknown) => {
      return await callback();
    });
    mocks.startSpan.mockReturnValue({
      end: vi.fn(),
    });
  });

  it('adds trigger metadata attributes to worker execution spans', async () => {
    scheduleWorkerJobExecution(
      {
        jobId: 'job-1',
        type: 'chat-response',
        input: { threadId: 'thread-1', prompt: 'hello' },
        userId: 'user-1',
      },
      {
        traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
        capturedAt: '2026-05-24T00:00:00.000Z',
        trigger: {
          source: 'learning-chat',
          action: 'send-message',
          pagePath: '/learning/chat',
          navigationElapsedMs: 1280,
          targetType: 'thread',
          targetId: 'thread-1',
          correlationId: 'b9e8ad89-c6c4-42ef-ad52-f74f0bec71a6',
        },
      } as never,
    );

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(mocks.startSpan).toHaveBeenCalledWith(
      'worker.job.execute',
      expect.objectContaining({
        attributes: expect.objectContaining({
          'app.trigger.source': 'learning-chat',
          'app.trigger.action': 'send-message',
          'app.trigger.page_path': '/learning/chat',
          'app.trigger.navigation_elapsed_ms': 1280,
          'app.trigger.target_type': 'thread',
          'app.trigger.target_id': 'thread-1',
          'app.trigger.correlation_id': 'b9e8ad89-c6c4-42ef-ad52-f74f0bec71a6',
        }),
      }),
    );
  });

  it('records queue wait duration when causality includes capturedAt', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-05-24T00:00:05.000Z').getTime(),
    );
    scheduleWorkerJobExecution(
      {
        jobId: 'job-queue-latency',
        type: 'chat-response',
        input: { threadId: 'thread-1', prompt: 'hello' },
        userId: 'user-1',
      },
      {
        traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
        capturedAt: '2026-05-24T00:00:00.000Z',
      } as never,
    );

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(mocks.startSpan).toHaveBeenCalledWith(
      'worker.job.execute',
      expect.objectContaining({
        attributes: expect.objectContaining({
          'job.queue_wait_ms': 5000,
        }),
      }),
    );
    expect(mocks.recordJobQueueWait).toHaveBeenCalledWith(5000, 'chat-response');
    nowSpy.mockRestore();
  });
});

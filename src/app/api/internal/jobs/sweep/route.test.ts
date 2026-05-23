import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sweepStaleRunningJobs: vi.fn(),
  sweepOrphanJobs: vi.fn(),
  redactTerminalJobs: vi.fn(),
  jobStorageGet: vi.fn(),
  getThreadById: vi.fn(),
  updateThread: vi.fn(),
  jobEventBusSweep: vi.fn(),
  appendTerminalIfNotTerminated: vi.fn(),
  withExtractedTraceContext: vi.fn(),
}));

vi.mock('@/worker/jobs/retention', () => ({
  sweepStaleRunningJobs: mocks.sweepStaleRunningJobs,
  sweepOrphanJobs: mocks.sweepOrphanJobs,
  redactTerminalJobs: mocks.redactTerminalJobs,
}));

vi.mock('@/lib/jobs', () => ({
  jobStorage: { get: mocks.jobStorageGet },
}));

vi.mock('@/lib/jobs/storage/threads-storage', () => ({
  getThreadById: mocks.getThreadById,
  updateThread: mocks.updateThread,
}));

vi.mock('@/worker/jobs/streaming/event-bus', () => ({
  jobEventBus: {
    sweep: mocks.jobEventBusSweep,
    appendTerminalIfNotTerminated: mocks.appendTerminalIfNotTerminated,
  },
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
  mocks.sweepStaleRunningJobs.mockResolvedValue({ deleted: 1, inspected: 2, sweptIds: [] });
  mocks.sweepOrphanJobs.mockResolvedValue({ deleted: 0, inspected: 3 });
  mocks.redactTerminalJobs.mockResolvedValue({ deleted: 4, inspected: 5 });
  mocks.jobEventBusSweep.mockReturnValue(0);
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
      staleRunningJobs: { deleted: 1, inspected: 2, sweptIds: [] },
      orphanJobs: { deleted: 0, inspected: 3 },
      redactedTerminalJobs: { deleted: 4, inspected: 5 },
      sweptEventBuffers: 0,
    });
  });

  it('annotates the durable chat thread and emits a terminal SSE frame for every swept chat job', async () => {
    mocks.sweepStaleRunningJobs.mockResolvedValue({ deleted: 1, inspected: 2, sweptIds: ['job-x'] });
    mocks.jobStorageGet.mockResolvedValue({
      id: 'job-x',
      userId: 'u-1',
      type: 'chat-response',
      status: 'failed',
      input: { threadId: 't-1', assistantMessageId: 'a-1' },
    });
    mocks.getThreadById.mockResolvedValue({
      id: 't-1',
      title: 't',
      isStreaming: true,
      createdAt: 'x',
      updatedAt: 'x',
      messages: [
        { id: 'u-msg', role: 'user', content: 'hi', timestamp: 'x' },
        { id: 'a-1', role: 'assistant', content: 'partial', timestamp: 'x' },
      ],
    });
    mocks.updateThread.mockResolvedValue(undefined);
    mocks.jobEventBusSweep.mockReturnValue(3);

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sweptEventBuffers).toBe(3);
    expect(mocks.updateThread).toHaveBeenCalledTimes(1);
    const updated = mocks.updateThread.mock.calls[0][1];
    const annotated = updated.messages.find((m: { id: string }) => m.id === 'a-1');
    expect(annotated.content).toContain('*(Response interrupted)*');
    expect(updated.isStreaming).toBe(false);
    expect(mocks.appendTerminalIfNotTerminated).toHaveBeenCalledWith('job-x', {
      type: 'failed',
      message: 'Job interrupted by sweep',
    });
  });

  it('forwards nowMs to sweepStaleRunningJobs', async () => {
    const res = await POST(makeRequest({ nowMs: 1_700_000_000_000 }));
    expect(res.status).toBe(200);
    expect(mocks.sweepStaleRunningJobs).toHaveBeenCalledWith(1_700_000_000_000);
    expect(mocks.jobEventBusSweep).toHaveBeenCalledWith(1_700_000_000_000);
  });
});

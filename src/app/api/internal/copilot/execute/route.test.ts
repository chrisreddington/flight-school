import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeCopilotChatInWorkerRuntime: vi.fn(),
}));

vi.mock('@/lib/copilot/runtime/worker-executor', () => ({
  executeCopilotChatInWorkerRuntime: mocks.executeCopilotChatInWorkerRuntime,
}));

import { POST } from './route';

function makeRequest(body: unknown, token = 'local-secret') {
  return new Request('http://localhost/api/internal/copilot/execute', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }) as never;
}

describe('/api/internal/copilot/execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('COPILOT_WORKER_SECRET', 'local-secret');
    mocks.executeCopilotChatInWorkerRuntime.mockResolvedValue({
      response: 'answer',
      toolCalls: [],
      meta: {
        generatedAt: '2026-05-22T18:00:00.000Z',
        model: 'claude-haiku-4.5',
        toolsUsed: [],
        totalTimeMs: 10,
        profile: 'chat',
        sessionCreateMs: null,
        sessionPoolHit: null,
        mcpEnabled: null,
        sessionReused: null,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 404 when worker mode is disabled', async () => {
    vi.stubEnv('COPILOT_WORKER_MODE', '0');

    const response = await POST(makeRequest({}));

    expect(response.status).toBe(404);
    expect(mocks.executeCopilotChatInWorkerRuntime).not.toHaveBeenCalled();
  });

  it('returns 401 when bearer auth is missing or wrong', async () => {
    vi.stubEnv('COPILOT_WORKER_MODE', '1');

    const response = await POST(makeRequest({}, 'wrong-secret'));

    expect(response.status).toBe(401);
    expect(mocks.executeCopilotChatInWorkerRuntime).not.toHaveBeenCalled();
  });

  it('returns 400 without echoing tokens when the worker request is invalid', async () => {
    vi.stubEnv('COPILOT_WORKER_MODE', '1');

    const response = await POST(makeRequest({
      identity: { userId: '123', gitHubToken: 'ghu_user' },
    }));
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).toContain('Invalid worker request');
    expect(text).not.toContain('ghu_user');
    expect(mocks.executeCopilotChatInWorkerRuntime).not.toHaveBeenCalled();
  });

  it('executes valid worker requests in-process', async () => {
    vi.stubEnv('COPILOT_WORKER_MODE', '1');
    const request = {
      identity: { userId: '123', gitHubToken: 'ghu_user' },
      prompt: 'hello',
      profile: 'chat',
      conversationId: 'thread-1',
    };

    const response = await POST(makeRequest(request));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.response).toBe('answer');
    expect(mocks.executeCopilotChatInWorkerRuntime).toHaveBeenCalledWith(request);
  });

  it('returns 500 without echoing tokens when execution fails', async () => {
    vi.stubEnv('COPILOT_WORKER_MODE', '1');
    mocks.executeCopilotChatInWorkerRuntime.mockRejectedValue(new Error('SDK failed for ghu_user'));

    const response = await POST(makeRequest({
      identity: { userId: '123', gitHubToken: 'ghu_user' },
      prompt: 'hello',
      profile: 'chat',
    }));
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).toContain('Worker execution failed');
    expect(text).not.toContain('ghu_user');
  });
});

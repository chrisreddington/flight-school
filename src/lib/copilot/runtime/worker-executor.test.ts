import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createCopilotUserRuntime: vi.fn(),
  getCopilotRuntimeHome: vi.fn(),
}));

vi.mock('./user-runtime', () => ({
  createCopilotUserRuntime: mocks.createCopilotUserRuntime,
}));

vi.mock('./user-home', () => ({
  getCopilotRuntimeHome: mocks.getCopilotRuntimeHome,
}));

vi.mock('./config', () => ({
  getCopilotRuntimeConfig: () => ({
    idleTtlMs: 60_000,
    maxActiveRuntimes: 2,
    homeRoot: '/tmp/runtimes',
  }),
}));

import { executeCopilotChatInWorkerRuntime, shutdownCopilotWorkerRuntimes } from './worker-executor';

describe('executeCopilotChatInWorkerRuntime', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await shutdownCopilotWorkerRuntimes();
    mocks.getCopilotRuntimeHome.mockImplementation((root: string, userId: string) => `${root}/${userId}`);
    mocks.createCopilotUserRuntime.mockImplementation(async ({ userId, copilotHome }) => ({
      userId,
      copilotHome,
      executeChat: vi.fn(async () => ({
        response: `answer-${userId}`,
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
      })),
      disconnect: vi.fn(),
    }));
  });

  it('creates a runtime using request identity and returns its chat result', async () => {
    const result = await executeCopilotChatInWorkerRuntime({
      identity: { userId: '123', gitHubToken: 'ghu_user' },
      prompt: 'hello',
    });

    expect(result.response).toBe('answer-123');
    expect(mocks.createCopilotUserRuntime).toHaveBeenCalledWith({
      userId: '123',
      gitHubToken: 'ghu_user',
      copilotHome: '/tmp/runtimes/123',
    });
  });

  it('reuses the runtime for the same user', async () => {
    const request = { identity: { userId: '123', gitHubToken: 'ghu_user' }, prompt: 'hello' };

    await executeCopilotChatInWorkerRuntime(request);
    await executeCopilotChatInWorkerRuntime(request);

    expect(mocks.createCopilotUserRuntime).toHaveBeenCalledTimes(1);
  });

  it('creates separate runtimes for different users', async () => {
    await executeCopilotChatInWorkerRuntime({ identity: { userId: '123', gitHubToken: 'ghu_123' }, prompt: 'hello' });
    await executeCopilotChatInWorkerRuntime({ identity: { userId: '456', gitHubToken: 'ghu_456' }, prompt: 'hello' });

    expect(mocks.createCopilotUserRuntime).toHaveBeenCalledTimes(2);
    expect(mocks.createCopilotUserRuntime).toHaveBeenNthCalledWith(1, expect.objectContaining({ userId: '123', copilotHome: '/tmp/runtimes/123' }));
    expect(mocks.createCopilotUserRuntime).toHaveBeenNthCalledWith(2, expect.objectContaining({ userId: '456', copilotHome: '/tmp/runtimes/456' }));
  });
});

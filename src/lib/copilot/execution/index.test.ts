import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCopilotWorkerConfig: vi.fn(),
  executeCopilotChatViaWorker: vi.fn(),
}));

vi.mock('./config', () => ({
  getCopilotWorkerConfig: mocks.getCopilotWorkerConfig,
}));

vi.mock('./http-client', () => ({
  executeCopilotChatViaWorker: mocks.executeCopilotChatViaWorker,
}));

import { executeCopilotChat } from './index';

const request = {
  identity: { userId: '123', gitHubToken: 'ghu_user' },
  prompt: 'hello',
};

const result = {
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
};

describe('executeCopilotChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeCopilotChatViaWorker.mockResolvedValue(result);
  });

  it('throws a safe configuration error when no worker is configured', async () => {
    mocks.getCopilotWorkerConfig.mockReturnValue(null);

    await expect(executeCopilotChat(request)).rejects.toThrow('Copilot worker is required for chat execution');

    expect(mocks.executeCopilotChatViaWorker).not.toHaveBeenCalled();
  });

  it('uses worker execution when worker config is present', async () => {
    const config = { baseUrl: 'http://localhost:3001', secret: 'local-secret', timeoutMs: 120_000 };
    mocks.getCopilotWorkerConfig.mockReturnValue(config);

    await expect(executeCopilotChat(request)).resolves.toBe(result);

    expect(mocks.executeCopilotChatViaWorker).toHaveBeenCalledWith(config, request);
  });

  it('propagates worker failures without any in-process fallback', async () => {
    const config = { baseUrl: 'http://localhost:3001', secret: 'local-secret', timeoutMs: 120_000 };
    mocks.getCopilotWorkerConfig.mockReturnValue(config);
    mocks.executeCopilotChatViaWorker.mockRejectedValue(new Error('worker unavailable'));

    await expect(executeCopilotChat(request)).rejects.toThrow('worker unavailable');
  });
});

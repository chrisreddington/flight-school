import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCopilotWorkerConfig: vi.fn(),
  executeCopilotChatViaWorker: vi.fn(),
  executeCopilotChatInProcess: vi.fn(),
}));

vi.mock('./config', () => ({
  getCopilotWorkerConfig: mocks.getCopilotWorkerConfig,
}));

vi.mock('./http-client', () => ({
  executeCopilotChatViaWorker: mocks.executeCopilotChatViaWorker,
}));

vi.mock('./in-process', () => ({
  executeCopilotChatInProcess: mocks.executeCopilotChatInProcess,
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
    usedGitHubTools: false,
    sessionCreateMs: null,
    sessionPoolHit: null,
    mcpEnabled: null,
    sessionReused: null,
  },
};

describe('executeCopilotChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeCopilotChatInProcess.mockResolvedValue(result);
    mocks.executeCopilotChatViaWorker.mockResolvedValue(result);
  });

  it('uses in-process execution when no worker is configured', async () => {
    mocks.getCopilotWorkerConfig.mockReturnValue(null);

    await expect(executeCopilotChat(request)).resolves.toBe(result);

    expect(mocks.executeCopilotChatInProcess).toHaveBeenCalledWith(request);
    expect(mocks.executeCopilotChatViaWorker).not.toHaveBeenCalled();
  });

  it('uses worker execution when worker config is present', async () => {
    const config = { baseUrl: 'http://localhost:3001', secret: 'local-secret', timeoutMs: 120_000 };
    mocks.getCopilotWorkerConfig.mockReturnValue(config);

    await expect(executeCopilotChat(request)).resolves.toBe(result);

    expect(mocks.executeCopilotChatViaWorker).toHaveBeenCalledWith(config, request);
    expect(mocks.executeCopilotChatInProcess).not.toHaveBeenCalled();
  });

  it('propagates worker failures without falling back in-process', async () => {
    const config = { baseUrl: 'http://localhost:3001', secret: 'local-secret', timeoutMs: 120_000 };
    mocks.getCopilotWorkerConfig.mockReturnValue(config);
    mocks.executeCopilotChatViaWorker.mockRejectedValue(new Error('worker unavailable'));

    await expect(executeCopilotChat(request)).rejects.toThrow('worker unavailable');

    expect(mocks.executeCopilotChatInProcess).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCopilotChatViaWorker } from './http-client';

describe('executeCopilotChatViaWorker', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('posts chat execution requests to the worker with bearer auth', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
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
    }), { status: 200 }));

    const result = await executeCopilotChatViaWorker(
      { baseUrl: 'http://localhost:3001', secret: 'local-secret', timeoutMs: 120_000 },
      { identity: { userId: '123', gitHubToken: 'ghu_user' }, prompt: 'hello' },
    );

    expect(result.response).toBe('answer');
    expect(fetch).toHaveBeenCalledWith('http://localhost:3001/api/internal/copilot/execute', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ authorization: 'Bearer local-secret' }),
    }));
  });

  it('throws a worker error when the worker returns non-2xx', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: 'bad request' }), { status: 400 }));

    await expect(executeCopilotChatViaWorker(
      { baseUrl: 'http://localhost:3001', secret: 'local-secret', timeoutMs: 120_000 },
      { identity: { userId: '123', gitHubToken: 'ghu_user' }, prompt: 'hello' },
    )).rejects.toThrow('Copilot worker returned HTTP 400: bad request');
  });

  it('aborts the worker call when the timeout expires', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      (init?.signal as AbortSignal).addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));

    const result = executeCopilotChatViaWorker(
      { baseUrl: 'http://localhost:3001', secret: 'local-secret', timeoutMs: 10 },
      { identity: { userId: '123', gitHubToken: 'ghu_user' }, prompt: 'hello' },
    );
    const expectation = expect(result).rejects.toThrow('Copilot worker request timed out after 10ms');

    await vi.advanceTimersByTimeAsync(10);
    await expectation;
  });
});

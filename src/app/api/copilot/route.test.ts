import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeCopilotChat: vi.fn(),
  withGuardedRoute: vi.fn(),
}));

vi.mock('@/lib/security/guard', () => ({
  withGuardedRoute: mocks.withGuardedRoute,
}));

vi.mock('@/lib/api', () => ({
  parseJsonBody: async (request: Request) => ({ success: true, data: await request.json() }),
  validateObject: (value: unknown, name: string) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? null
      : `${name} must be an object`,
  validateRequiredString: (value: unknown, name: string) =>
    typeof value === 'string' && value.trim().length > 0
      ? null
      : `${name} is required`,
}));

vi.mock('@/lib/copilot/execution', () => ({
  executeCopilotChat: mocks.executeCopilotChat,
}));

vi.mock('@/lib/copilot/server', () => ({
  createSessionIdentity: (ctx: { userId: string; accessToken: string }) => ({
    userId: ctx.userId,
    gitHubToken: ctx.accessToken,
  }),
}));

import { CopilotWorkerRequiredError } from '@/lib/copilot/execution/worker-required-error';
import { POST } from './route';

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/copilot', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

describe('/api/copilot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withGuardedRoute.mockImplementation(async (_opts, work) => work({
      userId: '123',
      login: 'octo',
      accessToken: 'ghu_user',
    }));
    mocks.executeCopilotChat.mockResolvedValue({
      response: 'answer',
      toolCalls: [],
      meta: {
        generatedAt: '2026-05-22T16:00:00.000Z',
        model: 'claude-haiku-4.5',
        toolsUsed: [],
        totalTimeMs: 12,
        profile: 'chat',
        sessionCreateMs: 4,
        sessionPoolHit: false,
        mcpEnabled: false,
        sessionReused: false,
      },
    });
  });

  it('delegates chat execution through the Copilot execution boundary', async () => {
    const request = makeRequest({ prompt: 'hello', profile: 'chat', conversationId: 'thread-1' });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.response).toBe('answer');
    expect(body.meta.generatedAt).toBe('2026-05-22T16:00:00.000Z');
    expect(mocks.executeCopilotChat).toHaveBeenCalledWith({
      identity: { userId: '123', gitHubToken: 'ghu_user' },
      prompt: 'hello',
      profile: 'chat',
      conversationId: 'thread-1',
    });
  });

  it('does not call the execution boundary when validation fails', async () => {
    const request = makeRequest({ prompt: '' });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(mocks.executeCopilotChat).not.toHaveBeenCalled();
  });

  it('returns a safe configuration error when the worker is not configured', async () => {
    mocks.executeCopilotChat.mockRejectedValue(new CopilotWorkerRequiredError());

    const response = await POST(makeRequest({ prompt: 'hello with ghu_user token text', profile: 'chat' }));
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).toContain('Copilot worker is required for chat execution');
    expect(text).not.toContain('ghu_user');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSessionWithMetricsMock = vi.fn();

vi.mock('./sessions', async () => {
  const actual = await vi.importActual<typeof import('./sessions')>('./sessions');
  return {
    ...actual,
    createSessionWithMetrics: createSessionWithMetricsMock,
  };
});

vi.mock('./activity/logger', () => ({
  activityLogger: {
    logEvent: vi.fn(),
    startOperation: vi.fn(async () => ({ eventId: 'evt-1', complete: vi.fn() })),
  },
}));

vi.mock('@/lib/observability/telemetry', () => ({
  recordAiOperation: vi.fn(),
  setSpanError: vi.fn(),
  withSpan: vi.fn((_name, _attributes, callback) => callback({})),
}));

const { createLoggedCoachSession } = await import('./server');

describe('logged Copilot session factories', () => {
  const fakeSession = {
    on: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    sendAndWait: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    createSessionWithMetricsMock.mockResolvedValue({
      session: fakeSession,
      metrics: {
        poolKey: 'pool',
        createdNew: true,
        sessionCreateMs: 1,
        mcpEnabled: false,
        model: 'model',
        reusedConversation: false,
      },
    });
  });

  it('passes per-request GitHub token through for coach sessions', async () => {
    await createLoggedCoachSession({ userId: 'u1', gitHubToken: 'ghu_1' });

    expect(createSessionWithMetricsMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', gitHubToken: 'ghu_1' }),
    );
  });

  it('defaults coach sessions to the github capability (MCP-grounded)', async () => {
    await createLoggedCoachSession({ userId: 'u1', gitHubToken: 'ghu_1' }, 'Daily Focus', 'prompt');

    const opts = createSessionWithMetricsMock.mock.calls[0][0];
    expect(opts.profile).toBe('coach');
    expect(opts.capabilities.map((cap: { id: string }) => cap.id)).toEqual(['github']);
  });

  it('honours an empty capability list for the lightweight coach path', async () => {
    await createLoggedCoachSession({ userId: 'u1', gitHubToken: 'ghu_1' }, 'Quick suggestion', 'prompt', []);

    const opts = createSessionWithMetricsMock.mock.calls[0][0];
    expect(opts.profile).toBe('coach');
    expect(opts.capabilities).toEqual([]);
  });
});

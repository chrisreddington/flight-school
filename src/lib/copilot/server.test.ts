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

const {
  createLoggedCoachSession,
  createLoggedLightweightCoachSession,
} = await import('./server');

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

  it.each([
    ['coach', () => createLoggedCoachSession({ userId: 'u1', gitHubToken: 'ghu_1' })],
    ['lightweight coach', () => createLoggedLightweightCoachSession({ userId: 'u1', gitHubToken: 'ghu_1' })],
  ])('should pass per-request GitHub token for %s sessions', async (_name, createSession) => {
    await createSession();

    expect(createSessionWithMetricsMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', gitHubToken: 'ghu_1' }),
    );
  });

  it('creates coach sessions with the coach profile and github capability', async () => {
    await createLoggedCoachSession({ userId: 'u1', gitHubToken: 'ghu_1' }, 'Daily Focus', 'prompt');

    expect(createSessionWithMetricsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: 'coach',
        userId: 'u1',
        gitHubToken: 'ghu_1',
      }),
    );
    const opts = createSessionWithMetricsMock.mock.calls[0][0];
    expect(opts.capabilities.length).toBeGreaterThan(0);
    expect(opts.capabilities[0].id).toBe('github');
  });

  it('creates lightweight coach sessions with the coach-lightweight profile and no capabilities', async () => {
    await createLoggedLightweightCoachSession({ userId: 'u1', gitHubToken: 'ghu_1' });

    expect(createSessionWithMetricsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: 'coach-lightweight',
        userId: 'u1',
        gitHubToken: 'ghu_1',
      }),
    );
    const opts = createSessionWithMetricsMock.mock.calls[0][0];
    expect(opts.capabilities).toHaveLength(0);
  });
});

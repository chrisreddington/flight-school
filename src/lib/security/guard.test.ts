import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requireUserContextMock } = vi.hoisted(() => ({
  requireUserContextMock: vi.fn(),
}));
vi.mock('@/lib/auth/context', () => ({
  requireUserContext: requireUserContextMock,
  UnauthorizedError: class UnauthorizedError extends Error {
    readonly status = 401;
    constructor(message = 'Authentication required') {
      super(message);
      this.name = 'UnauthorizedError';
    }
  },
}));

import { __resetAuditState } from './audit';
import { withUserGuards } from './guard';
import { RateLimitedError, __resetRateLimitState } from './rate-limit';
import {
  TooManyConcurrentSessionsError,
  __getSlotCount,
  __resetSessionCapState,
} from './session-cap';

describe('withUserGuards', () => {
  beforeEach(() => {
    process.env.AUDIT_SALT = 'guard-test-salt';
    requireUserContextMock.mockResolvedValue({
      userId: '42',
      login: 'octocat',
      accessToken: 'ghu_token',
    });
  });

  afterEach(() => {
    requireUserContextMock.mockReset();
    __resetRateLimitState();
    __resetSessionCapState();
    __resetAuditState();
    vi.restoreAllMocks();
  });

  it('invokes work with the user context and emits an audit log', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const work = vi.fn(async () => 'ok');

    const result = await withUserGuards(
      { eventType: 'copilot.session.create' },
      work,
    );

    expect(result).toBe('ok');
    expect(work).toHaveBeenCalledWith(
      expect.objectContaining({ userId: '42', login: 'octocat' }),
    );
    const auditCalls = infoSpy.mock.calls.filter((c) =>
      String(c[0]).includes('audit: copilot.session.create'),
    );
    expect(auditCalls.length).toBe(1);
  });

  it('throws RateLimitedError when the rate limit is exceeded', async () => {
    const opts = {
      eventType: 'copilot.session.create' as const,
      rateLimit: { limit: 1, windowMs: 60_000 },
    };
    await withUserGuards(opts, async () => 'first');
    await expect(withUserGuards(opts, async () => 'second')).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });

  it('throws TooManyConcurrentSessionsError when the cap is reached', async () => {
    const opts = {
      eventType: 'copilot.session.create' as const,
      concurrentCap: 1,
    };
    let release!: () => void;
    const hold = new Promise<string>((resolve) => {
      release = () => resolve('done');
    });

    const inflight = withUserGuards(opts, async () => hold);
    await Promise.resolve();
    await expect(withUserGuards(opts, async () => 'no')).rejects.toBeInstanceOf(
      TooManyConcurrentSessionsError,
    );
    release();
    await inflight;
    expect(__getSlotCount('42')).toBe(0);
  });

  it('releases the slot even when work throws', async () => {
    const opts = {
      eventType: 'copilot.session.create' as const,
      concurrentCap: 1,
    };
    await expect(
      withUserGuards(opts, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(__getSlotCount('42')).toBe(0);
  });

  it('logs a rate-limit.blocked audit event when blocking', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const opts = {
      eventType: 'copilot.session.create' as const,
      rateLimit: { limit: 1, windowMs: 60_000 },
    };
    await withUserGuards(opts, async () => 'first');
    await expect(
      withUserGuards(opts, async () => 'second'),
    ).rejects.toBeInstanceOf(RateLimitedError);
    expect(
      infoSpy.mock.calls.some((c) =>
        String(c[0]).includes('audit: rate-limit.blocked'),
      ),
    ).toBe(true);
  });
});

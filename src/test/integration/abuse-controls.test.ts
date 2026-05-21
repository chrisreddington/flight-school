/**
 * Abuse controls integration tests.
 *
 * Verifies that a wrapped route with `withUserGuards`:
 *   - Allows up to `limit` requests in a window and 429s the next one.
 *   - Honors a concurrent-session cap by 429ing the (cap+1)th in-flight call.
 *   - Resets a slot when work resolves or throws.
 *   - Keeps rate-limit and concurrency buckets per-user.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requireUserContextMock } = vi.hoisted(() => ({
  requireUserContextMock: vi.fn(),
}));
vi.mock('@/lib/auth/context', () => ({
  requireUserContext: requireUserContextMock,
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

import { __resetAuditState } from '@/lib/security/audit';
import { withUserGuards } from '@/lib/security/guard';
import {
  RateLimitedError,
  __resetRateLimitState,
} from '@/lib/security/rate-limit';
import {
  TooManyConcurrentSessionsError,
  __getSlotCount,
  __resetSessionCapState,
} from '@/lib/security/session-cap';

const userA = { userId: 'A', login: 'alice', accessToken: 'ghu_a' };
const userB = { userId: 'B', login: 'bob', accessToken: 'ghu_b' };

describe('abuse controls integration', () => {
  beforeEach(() => {
    process.env.AUDIT_SALT = 'abuse-test-salt';
    __resetRateLimitState();
    __resetSessionCapState();
    __resetAuditState();
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    requireUserContextMock.mockReset();
    vi.restoreAllMocks();
  });

  describe('rate limiting', () => {
    beforeEach(() => {
      requireUserContextMock.mockResolvedValue(userA);
    });

    it('allows the first 10 calls and blocks the 11th in a window of limit=10', async () => {
      const opts = {
        eventType: 'copilot.session.create' as const,
        rateLimit: { limit: 10, windowMs: 60_000 },
      };

      for (let i = 0; i < 10; i++) {
        await expect(withUserGuards(opts, async () => i)).resolves.toBe(i);
      }
      await expect(withUserGuards(opts, async () => 'eleven')).rejects.toBeInstanceOf(
        RateLimitedError,
      );
    });

    it('includes a positive retryAfterMs on the RateLimitedError', async () => {
      const opts = {
        eventType: 'copilot.session.create' as const,
        rateLimit: { limit: 1, windowMs: 60_000 },
      };
      await withUserGuards(opts, async () => 'one');
      const err = await withUserGuards(opts, async () => 'two').catch((e) => e);
      expect(err).toBeInstanceOf(RateLimitedError);
      expect((err as RateLimitedError).retryAfterMs).toBeGreaterThan(0);
      expect((err as RateLimitedError).status).toBe(429);
    });

    it('isolates rate-limit buckets per user', async () => {
      const opts = {
        eventType: 'copilot.session.create' as const,
        rateLimit: { limit: 1, windowMs: 60_000 },
      };

      requireUserContextMock.mockResolvedValue(userA);
      await withUserGuards(opts, async () => 'a1');
      await expect(withUserGuards(opts, async () => 'a2')).rejects.toBeInstanceOf(
        RateLimitedError,
      );

      requireUserContextMock.mockResolvedValue(userB);
      await expect(withUserGuards(opts, async () => 'b1')).resolves.toBe('b1');
    });
  });

  describe('concurrent session cap', () => {
    beforeEach(() => {
      requireUserContextMock.mockResolvedValue(userA);
    });

    it('blocks the 3rd in-flight call when cap=2', async () => {
      const opts = {
        eventType: 'copilot.session.create' as const,
        concurrentCap: 2,
      };

      const releasers: Array<() => void> = [];
      const inflight: Array<Promise<string>> = [];
      for (let i = 0; i < 2; i++) {
        const work = new Promise<string>((resolve) => {
          releasers.push(() => resolve(`slot-${i}`));
        });
        inflight.push(withUserGuards(opts, () => work));
      }
      // Let the two acquires settle before launching the third.
      await new Promise((r) => setImmediate(r));
      expect(__getSlotCount('A')).toBe(2);

      await expect(withUserGuards(opts, async () => 'third')).rejects.toBeInstanceOf(
        TooManyConcurrentSessionsError,
      );

      // Drain the held work and confirm slots release.
      releasers.forEach((r) => r());
      await Promise.all(inflight);
      expect(__getSlotCount('A')).toBe(0);
    });

    it('releases the slot when work throws', async () => {
      const opts = {
        eventType: 'copilot.session.create' as const,
        concurrentCap: 1,
      };

      await expect(
        withUserGuards(opts, async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(__getSlotCount('A')).toBe(0);
      await expect(withUserGuards(opts, async () => 'ok')).resolves.toBe('ok');
    });

    it('isolates concurrency buckets per user', async () => {
      const opts = {
        eventType: 'copilot.session.create' as const,
        concurrentCap: 1,
      };

      requireUserContextMock.mockResolvedValue(userA);
      let releaseA!: () => void;
      const holdA = new Promise<string>((r) => {
        releaseA = () => r('a');
      });
      const inflightA = withUserGuards(opts, () => holdA);
      await new Promise((r) => setImmediate(r));

      // userB should still be able to acquire its own slot.
      requireUserContextMock.mockResolvedValue(userB);
      await expect(withUserGuards(opts, async () => 'b')).resolves.toBe('b');

      releaseA();
      await inflightA;
      expect(__getSlotCount('A')).toBe(0);
      expect(__getSlotCount('B')).toBe(0);
    });
  });
});

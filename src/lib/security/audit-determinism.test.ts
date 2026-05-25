/**
 * Audit hash determinism — integration coverage.
 *
 * The unit tests in `audit.test.ts` cover salt + hashing in isolation.
 * This file pins down the cross-cutting properties that matter for
 * security review:
 *   - Same userId + same salt = same hash, across both calls AND
 *     across an audited operation (verified through `withUserGuards`).
 *   - Same userId + different salt = different hash (no salt leakage).
 *   - Many users do not collide under the same salt.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requireUserContextMock } = vi.hoisted(() => ({
  requireUserContextMock: vi.fn(),
}));
vi.mock('@/lib/auth/context', () => ({
  requireUserContext: requireUserContextMock,
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

import { __resetAuditState, hashUserId } from '@/lib/security/audit';
import { __resetRateLimitState } from '@/lib/security/rate-limit';
import { __resetSessionCapState } from '@/lib/security/session-cap';
import { withUserGuards } from '@/lib/security/guard';

const ORIGINAL_SALT = process.env.AUDIT_SALT;

describe('audit hash determinism', () => {
  beforeEach(() => {
    __resetAuditState();
    __resetRateLimitState();
    __resetSessionCapState();
  });

  afterEach(() => {
    if (ORIGINAL_SALT === undefined) delete process.env.AUDIT_SALT;
    else process.env.AUDIT_SALT = ORIGINAL_SALT;
    __resetAuditState();
    vi.restoreAllMocks();
  });

  it('produces the same hash for the same userId + salt across calls', () => {
    process.env.AUDIT_SALT = 'pinned-salt-A';
    const first = hashUserId('user-42');
    const second = hashUserId('user-42');
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes when the salt changes', () => {
    process.env.AUDIT_SALT = 'salt-A';
    const a = hashUserId('user-42');
    __resetAuditState();
    process.env.AUDIT_SALT = 'salt-B';
    const b = hashUserId('user-42');
    expect(a).not.toBe(b);
  });

  it('does not collide across many users under a fixed salt', () => {
    process.env.AUDIT_SALT = 'collision-test-salt';
    const hashes = new Set<string>();
    for (let i = 0; i < 200; i++) hashes.add(hashUserId(`user-${i}`));
    expect(hashes.size).toBe(200);
  });

  it('emits the same userIdHash across consecutive audited operations', async () => {
    process.env.AUDIT_SALT = 'guard-determinism-salt';
    requireUserContextMock.mockResolvedValue({
      userId: 'user-77',
      login: 'octocat',
      accessToken: 'ghu_x',
    });
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    await withUserGuards({ eventType: 'copilot.session.create' }, async () => 'a');
    await withUserGuards({ eventType: 'copilot.session.create' }, async () => 'b');

    const auditCalls = infoSpy.mock.calls
      .filter((c) => String(c[0]).includes('audit: copilot.session.create'))
      .map((c) => (c[1] as { userIdHash: string }).userIdHash);

    expect(auditCalls.length).toBe(2);
    expect(auditCalls[0]).toBe(auditCalls[1]);
    expect(auditCalls[0]).toBe(hashUserId('user-77'));
  });
});

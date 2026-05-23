import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetAuditState, auditLog, hashUserId } from './audit';

const originalSalt = process.env.AUDIT_SALT;

describe('audit log', () => {
  beforeEach(() => {
    __resetAuditState();
  });

  afterEach(() => {
    if (originalSalt === undefined) {
      delete process.env.AUDIT_SALT;
    } else {
      process.env.AUDIT_SALT = originalSalt;
    }
    __resetAuditState();
    vi.restoreAllMocks();
  });

  it('produces deterministic hashes for the same salt', () => {
    process.env.AUDIT_SALT = 'fixed-salt-for-tests';
    const a = hashUserId('42');
    __resetAuditState();
    process.env.AUDIT_SALT = 'fixed-salt-for-tests';
    const b = hashUserId('42');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different users with the same salt', () => {
    process.env.AUDIT_SALT = 'fixed-salt-for-tests';
    expect(hashUserId('1')).not.toBe(hashUserId('2'));
  });

  it('produces different hashes with different salts', () => {
    process.env.AUDIT_SALT = 'salt-one';
    const first = hashUserId('42');
    __resetAuditState();
    process.env.AUDIT_SALT = 'salt-two';
    const second = hashUserId('42');
    expect(first).not.toBe(second);
  });

  it('emits an info log line with audit: prefix and metadata', async () => {
    process.env.AUDIT_SALT = 'fixed-salt-for-tests';
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    auditLog({
      type: 'copilot.session.create',
      userIdHash: hashUserId('42'),
      metadata: { route: '/api/focus' },
    });

    expect(infoSpy).toHaveBeenCalled();
    const [message, data] = infoSpy.mock.calls[0];
    expect(String(message)).toContain('audit: copilot.session.create');
    expect(data).toMatchObject({ route: '/api/focus' });
    expect(typeof (data as { userIdHash: string }).userIdHash).toBe('string');
  });

  it('warns once when AUDIT_SALT is missing', () => {
    delete process.env.AUDIT_SALT;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    hashUserId('42');
    hashUserId('43');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

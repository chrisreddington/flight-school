import { afterEach, describe, expect, it } from 'vitest';

import { requireAuditSalt } from './audit-salt';

const ORIGINAL_AUDIT_SALT = process.env.AUDIT_SALT;

describe('requireAuditSalt', () => {
  afterEach(() => {
    if (ORIGINAL_AUDIT_SALT === undefined) delete process.env.AUDIT_SALT;
    else process.env.AUDIT_SALT = ORIGINAL_AUDIT_SALT;
  });

  it('returns the configured salt when AUDIT_SALT is set', () => {
    process.env.AUDIT_SALT = 'test-salt';
    expect(requireAuditSalt('worker:bootstrap')).toBe('test-salt');
  });

  it('throws with caller context when AUDIT_SALT is missing', () => {
    delete process.env.AUDIT_SALT;
    expect(() => requireAuditSalt('web:instrumentation')).toThrowError('[web:instrumentation] AUDIT_SALT is required.');
  });
});

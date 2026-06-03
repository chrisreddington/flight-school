/**
 * Audit logging for security-sensitive events.
 *
 * Emits a structured `audit:` line through the application logger. User
 * identifiers are hashed with SHA-256 + a salt so audit logs can be
 * exported / retained without leaking GitHub IDs.
 *
 * @remarks
 * **Sink**: For MVP the audit trail is written through {@link logger} at
 * info level. A future enhancement is to fan these out to a structured
 * sink (Application Insights custom event, OpenTelemetry log record, or
 * an append-only blob) so they survive log-rotation policies and can be
 * queried for security review.
 *
 * **Salt**: `AUDIT_SALT` is required in all environments. Startup and
 * first-use call sites enforce this through `requireAuditSalt(...)`.
 */

import { createHash } from 'node:crypto';

import { logger } from '@/lib/logger';
import { requireAuditSalt } from '@/lib/security/audit-salt';

const log = logger.withTag('Audit');

export type AuditEventType =
  | 'copilot.session.create'
  | 'job.create'
  | 'auth.signin'
  | 'rate-limit.blocked'
  | 'session-cap.blocked'
  | 'job.credentials_missing'
  | 'job.credentials_refresh_failed'
  | 'storage.write'
  | 'issues.create'
  | 'page.view'
  | 'challenge.view';

export interface AuditEvent {
  type: AuditEventType;
  /** SHA-256(salt + userId), lowercase hex. */
  userIdHash: string;
  metadata?: Record<string, unknown>;
}

let cachedSalt: string | null = null;

function getSalt(): string {
  if (cachedSalt !== null) return cachedSalt;
  cachedSalt = requireAuditSalt('audit:first-call');
  return cachedSalt;
}

/**
 * Hash a raw user identifier with the configured audit salt.
 *
 * @throws Error when `AUDIT_SALT` is missing.
 */
export function hashUserId(userId: string): string {
  const salt = getSalt();
  return createHash('sha256').update(salt).update(':').update(userId).digest('hex');
}

/**
 * Emit an audit event for a security-sensitive operation.
 *
 * @remarks Never throws. The event is forwarded to {@link logger} at info
 *   level; any sink-side failure is absorbed by the logger so callers on
 *   security-sensitive paths can fire-and-forget.
 */
export function auditLog(event: AuditEvent): void {
  const { type, userIdHash, metadata } = event;
  log.info(`audit: ${type}`, { userIdHash, ...metadata });
}

/**
 * Test-only helper to clear cached salt between test cases.
 *
 * @internal
 */
export function __resetAuditState() {
  cachedSalt = null;
}

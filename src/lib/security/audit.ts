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
 * **Salt**: Set `AUDIT_SALT` to a long random string in production. In
 * development a per-boot random value is used; a warning is emitted on
 * first use so the misconfiguration is visible.
 */

import { createHash, randomBytes } from 'node:crypto';

import { logger } from '@/lib/logger';

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
  | 'page.view';

export interface AuditEvent {
  type: AuditEventType;
  /** SHA-256(salt + userId), lowercase hex. */
  userIdHash: string;
  metadata?: Record<string, unknown>;
}

let cachedSalt: string | null = null;
let warnedAboutDevSalt = false;

function getSalt(): string {
  if (cachedSalt) return cachedSalt;
  const fromEnv = process.env.AUDIT_SALT;
  if (fromEnv && fromEnv.length > 0) {
    cachedSalt = fromEnv;
    return cachedSalt;
  }

  cachedSalt = randomBytes(32).toString('hex');
  if (!warnedAboutDevSalt) {
    warnedAboutDevSalt = true;
    log.warn(
      'AUDIT_SALT is not set; using a random per-boot salt. ' +
        'Audit hashes will not be comparable across restarts. ' +
        'Set AUDIT_SALT in production.',
    );
  }
  return cachedSalt;
}

/**
 * Hash a raw user identifier with the configured audit salt.
 *
 * @remarks Never throws. When `AUDIT_SALT` is unset, falls back to a
 *   process-lifetime random salt and emits a one-time warning via
 *   {@link logger} — hashes remain stable for the current process but are
 *   not comparable across restarts.
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
 * Test-only helper to clear cached salt + warn state between test cases.
 *
 * @internal
 */
export function __resetAuditState() {
  cachedSalt = null;
  warnedAboutDevSalt = false;
}

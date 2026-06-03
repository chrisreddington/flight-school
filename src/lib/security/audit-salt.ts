/**
 * Returns the configured audit salt or throws with caller context.
 *
 * @throws Error when `AUDIT_SALT` is missing.
 */
export function requireAuditSalt(callerContext: string): string {
  const salt = process.env.AUDIT_SALT?.trim();
  if (salt) {
    return salt;
  }

  throw new Error(
    `[${callerContext}] AUDIT_SALT is required. ` + 'Run: echo "AUDIT_SALT=$(openssl rand -hex 32)" >> .env.local',
  );
}

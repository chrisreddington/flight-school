/**
 * Default per-route guard configuration, with environment overrides.
 *
 * Routes import the relevant constant and pass it directly to
 * {@link withUserGuards}. Environment variables let operators tighten the
 * defaults without a redeploy:
 *
 * - `RATE_LIMIT_FOCUS_PER_MIN`, `RATE_LIMIT_FOCUS_CAP`
 * - `RATE_LIMIT_CHAT_PER_MIN`, `RATE_LIMIT_CHAT_CAP`
 * - `RATE_LIMIT_EVAL_PER_MIN`, `RATE_LIMIT_EVAL_CAP`
 * - `RATE_LIMIT_SUGGESTIONS_PER_MIN`, `RATE_LIMIT_SUGGESTIONS_CAP`
 */

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const FOCUS_GUARD = {
  rateLimit: { limit: num('RATE_LIMIT_FOCUS_PER_MIN', 10), windowMs: 60_000 },
  concurrentCap: num('RATE_LIMIT_FOCUS_CAP', 2),
} as const;

export const CHAT_GUARD = {
  rateLimit: { limit: num('RATE_LIMIT_CHAT_PER_MIN', 30), windowMs: 60_000 },
  concurrentCap: num('RATE_LIMIT_CHAT_CAP', 3),
} as const;

export const EVAL_GUARD = {
  rateLimit: { limit: num('RATE_LIMIT_EVAL_PER_MIN', 20), windowMs: 60_000 },
  concurrentCap: num('RATE_LIMIT_EVAL_CAP', 2),
} as const;

export const SUGGESTIONS_GUARD = {
  rateLimit: { limit: num('RATE_LIMIT_SUGGESTIONS_PER_MIN', 20), windowMs: 60_000 },
  concurrentCap: num('RATE_LIMIT_SUGGESTIONS_CAP', 2),
} as const;

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
 * - `RATE_LIMIT_QUIZ_PER_MIN`, `RATE_LIMIT_QUIZ_CAP`
 * - `RATE_LIMIT_PLAN_PER_MIN`, `RATE_LIMIT_PLAN_CAP`
 * - `RATE_LIMIT_AUTHOR_PER_MIN`, `RATE_LIMIT_AUTHOR_CAP`
 */

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const FOCUS_GUARD = {
  rateLimit: { limit: num('RATE_LIMIT_FOCUS_PER_MIN', 10), windowMs: 60_000 },
  // Dashboard fan-out: the focus hook fires `challenge`, `goal`, and
  // `learningTopics` in parallel via Promise.allSettled, so the cap must
  // accommodate at least 3 simultaneous requests per user.
  concurrentCap: num('RATE_LIMIT_FOCUS_CAP', 3),
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

export const QUIZ_GUARD = {
  rateLimit: { limit: num('RATE_LIMIT_QUIZ_PER_MIN', 15), windowMs: 60_000 },
  concurrentCap: num('RATE_LIMIT_QUIZ_CAP', 2),
} as const;

export const PLAN_GUARD = {
  rateLimit: { limit: num('RATE_LIMIT_PLAN_PER_MIN', 15), windowMs: 60_000 },
  concurrentCap: num('RATE_LIMIT_PLAN_CAP', 2),
} as const;

export const AUTHOR_GUARD = {
  rateLimit: { limit: num('RATE_LIMIT_AUTHOR_PER_MIN', 15), windowMs: 60_000 },
  concurrentCap: num('RATE_LIMIT_AUTHOR_CAP', 2),
} as const;

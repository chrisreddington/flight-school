/**
 * Public-facing DTO mappers for {@link BackgroundJob}.
 *
 * Background jobs store the user's raw prompt under `input.prompt` and
 * the model's raw response under `result`. Some job types
 * (challenge-evaluation, chat-response) also nest user code, broken
 * code, tool args/results, etc. Routes MUST funnel jobs through one of
 * the two mappers below before returning to the browser; never JSON-
 * stringify a {@link BackgroundJob} directly. Storage is left
 * untouched — the cron sweeper handles persistent redaction
 * separately via {@link redactTerminalJobs}.
 *
 * @module jobs/redact
 */

import 'server-only';
import type { BackgroundJob } from './storage';

/** Cap individual string fields in detail DTOs. */
const MAX_STRING_CHARS = 4_000;

/**
 * Identifier-only DTO returned by `GET /api/jobs` (list view).
 * Deliberately omits `input`, `result`, and `currentStep` — the list
 * view exists to enumerate jobs, not to read content.
 */
export interface JobListDTO {
  id: string;
  type: string;
  status: BackgroundJob['status'];
  targetId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  errorCode?: BackgroundJob['errorCode'];
}

/**
 * Map a raw {@link BackgroundJob} to the list-view DTO. Drops every
 * content-bearing field; surfaces only lifecycle metadata.
 */
export function redactJobForList(job: BackgroundJob): JobListDTO {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    targetId: job.targetId,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: typeof job.error === 'string' ? clamp(job.error, 500) : undefined,
    errorCode: job.errorCode,
  };
}

/**
 * Recursively cap every string in a value at {@link MAX_STRING_CHARS}
 * and drop a small allowlist of nested fields that are known to carry
 * heavy user-supplied content (broken code, file contents). The
 * walker only follows plain objects and arrays — class instances are
 * passed through untouched.
 */
function sanitizeDeep(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value;
  if (typeof value === 'string') return clamp(value, MAX_STRING_CHARS);
  if (Array.isArray(value)) return value.map((item) => sanitizeDeep(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'brokenCode') {
        out[key] = '[redacted]';
        continue;
      }
      if (key === 'content' && typeof raw === 'string') {
        // Heuristic: drop the body of evaluation `files[].content` blobs.
        out[key] = '[redacted]';
        continue;
      }
      out[key] = sanitizeDeep(raw, depth + 1);
    }
    return out;
  }
  return value;
}

function clamp(input: string, max: number): string {
  if (input.length <= max) return input;
  return input.slice(0, max) + `… [truncated, total ${input.length} chars]`;
}

/**
 * Map a raw {@link BackgroundJob} to the detail-view DTO. Preserves
 * the shape so the UI keeps working, but recursively caps long
 * strings and drops known-sensitive nested fields. `input.prompt` and
 * `result` are passed through {@link sanitizeDeep} so their bodies are
 * truncated at the 4 KB ceiling.
 */
export function redactJobForDetail(job: BackgroundJob): BackgroundJob {
  return {
    ...job,
    input: sanitizeDeep(job.input) as Record<string, unknown>,
    result: job.result === undefined ? undefined : (sanitizeDeep(job.result) as typeof job.result),
    error: typeof job.error === 'string' ? clamp(job.error, 500) : job.error,
    currentStep: typeof job.currentStep === 'string' ? clamp(job.currentStep, 200) : job.currentStep,
  };
}

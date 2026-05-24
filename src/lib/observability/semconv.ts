/**
 * OpenTelemetry semantic-convention constants for Flight School.
 *
 * This module is the single source of truth for:
 *
 * - **GenAI semconv attribute keys** (`gen_ai.*`) — see
 *   {@link https://opentelemetry.io/docs/specs/semconv/gen-ai/ | OTel GenAI semconv}.
 *   The spec is still in *Development* status, so names may churn; keeping
 *   them centralised means a future spec rename is a one-file change.
 * - **GenAI metric names and units** — `gen_ai.client.operation.duration`
 *   (seconds), `gen_ai.client.operation.time_to_first_chunk` (seconds),
 *   `gen_ai.client.token.usage` (tokens).
 * - **Flight School custom metric names** under the `flight_school.*`
 *   namespace for things without a standard equivalent.
 * - **Instrumentation-scope names** used when acquiring a tracer or meter.
 *
 * **Do not hard-code any of these strings elsewhere.** Import from here.
 *
 * @see `.github/skills/opentelemetry/SKILL.md`
 */

// ---------- Instrumentation scope ----------

/** Scope name for every server-side tracer and meter. */
export const INSTRUMENTATION_SCOPE_SERVER = 'flight-school.observability';

/** Scope name for every browser-side tracer. No browser meter exists. */
export const INSTRUMENTATION_SCOPE_BROWSER = 'flight-school.browser';

/** Scope version emitted alongside the names. Bump only on breaking changes to telemetry shape. */
export const INSTRUMENTATION_SCOPE_VERSION = '1.0.0';

// ---------- GenAI span attributes ----------

export const GEN_AI_OPERATION_NAME = 'gen_ai.operation.name';
export const GEN_AI_REQUEST_MODEL = 'gen_ai.request.model';
export const GEN_AI_PROVIDER_NAME = 'gen_ai.provider.name';
export const GEN_AI_TOKEN_TYPE = 'gen_ai.token.type';

/** Standard operation-name values used as `gen_ai.operation.name`. */
export const GEN_AI_OPERATION = {
  CHAT: 'chat',
  GENERATE_CONTENT: 'generate_content',
  EMBEDDINGS: 'embeddings',
  INVOKE_AGENT: 'invoke_agent',
  EXECUTE_TOOL: 'execute_tool',
  CREATE_AGENT: 'create_agent',
} as const;

/** Standard token-type values used as `gen_ai.token.type`. */
export const GEN_AI_TOKEN = {
  INPUT: 'input',
  OUTPUT: 'output',
  CACHE_READ: 'cache_read',
  CACHE_WRITE: 'cache_write',
} as const;

/** Provider value for the GitHub Copilot SDK. */
export const GEN_AI_PROVIDER_GITHUB_COPILOT = 'github-copilot';

// ---------- GenAI metric names ----------

/** Histogram, unit `s`. Duration of every AI operation, success or failure. */
export const METRIC_GEN_AI_CLIENT_OPERATION_DURATION = 'gen_ai.client.operation.duration';

/** Histogram, unit `s`. Latency from stream start to first delta. */
export const METRIC_GEN_AI_CLIENT_TIME_TO_FIRST_CHUNK = 'gen_ai.client.operation.time_to_first_chunk';

/** Histogram, unit `{token}`. Token counts per operation, split by `gen_ai.token.type`. */
export const METRIC_GEN_AI_CLIENT_TOKEN_USAGE = 'gen_ai.client.token.usage';

// ---------- Flight School custom metric names ----------

/** Histogram, unit `s`. Time from job capture to worker execution start. */
export const METRIC_FLIGHT_SCHOOL_JOBS_QUEUE_WAIT = 'flight_school.jobs.queue_wait';

/** Histogram, unit `{delta}`. Number of delta chunks per stream. */
export const METRIC_FLIGHT_SCHOOL_AI_STREAM_DELTA_COUNT = 'flight_school.ai.stream.delta_count';

/** Histogram, unit `By`. Total streamed bytes per stream. */
export const METRIC_FLIGHT_SCHOOL_AI_STREAM_DELTA_BYTES = 'flight_school.ai.stream.delta_bytes';

/** Counter, unit `{call}`. Tool calls observed during streaming. */
export const METRIC_FLIGHT_SCHOOL_AI_STREAM_TOOL_CALLS = 'flight_school.ai.stream.tool_calls';

/** Histogram, unit `s`. Duration of GitHub API operations. */
export const METRIC_FLIGHT_SCHOOL_GITHUB_DURATION = 'flight_school.github.duration';

/** Counter, unit `{request}`. GitHub API requests by outcome. */
export const METRIC_FLIGHT_SCHOOL_GITHUB_REQUESTS = 'flight_school.github.requests';

// ---------- Histogram bucket boundaries (from GenAI spec) ----------

/**
 * Recommended explicit-bucket boundaries for GenAI duration histograms
 * (`gen_ai.client.operation.duration`,
 * `gen_ai.client.operation.time_to_first_chunk`,
 * `gen_ai.client.operation.time_per_output_chunk`).
 *
 * Doubling progression from 10 ms to ~82 s — matches the boundaries the
 * GenAI semconv spec calls out as the recommended advisory parameter.
 *
 * @see {@link https://github.com/open-telemetry/semantic-conventions-genai/blob/main/model/gen-ai/metrics.yaml}
 */
export const GEN_AI_DURATION_BUCKETS = [
  0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28,
  2.56, 5.12, 10.24, 20.48, 40.96, 81.92,
];

/**
 * Recommended explicit-bucket boundaries for `gen_ai.client.token.usage`.
 * Geometric progression (power-of-4) spanning 1 to ~67M tokens.
 */
export const GEN_AI_TOKEN_USAGE_BUCKETS = [
  1, 4, 16, 64, 256, 1024, 4096, 16384, 65536,
  262144, 1048576, 4194304, 16777216, 67108864,
];

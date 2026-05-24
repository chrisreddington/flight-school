/**
 * Server-side OpenTelemetry tracer/meter wrappers and instrumentation
 * helpers for Flight School.
 *
 * All attribute keys, metric names, and the instrumentation-scope name
 * come from {@link ./semconv}. Don't introduce new strings inline — add
 * them to `semconv.ts` first.
 *
 * Conventions enforced by this module:
 *
 * - GenAI spans and metrics follow the OTel GenAI semantic conventions
 *   (`gen_ai.*` attribute names, `gen_ai.client.*` metric names, seconds
 *   as the duration unit).
 * - Span name for GenAI spans is `{operation} {model}` (e.g. `chat gpt-4o`).
 * - Errors set `SpanStatusCode.ERROR` plus an `error.type` attribute —
 *   never a freeform `ai.status` field.
 * - Custom Flight-School-specific metrics use the `flight_school.*`
 *   namespace and emit seconds (not ms).
 *
 * @see `.github/skills/opentelemetry/SKILL.md`
 */

import {
  context,
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api';

import {
  GEN_AI_OPERATION_NAME,
  GEN_AI_PROVIDER_GITHUB_COPILOT,
  GEN_AI_PROVIDER_NAME,
  GEN_AI_REQUEST_MODEL,
  GEN_AI_TOKEN,
  GEN_AI_TOKEN_TYPE,
  INSTRUMENTATION_SCOPE_SERVER,
  INSTRUMENTATION_SCOPE_VERSION,
  METRIC_FLIGHT_SCHOOL_AI_STREAM_DELTA_BYTES,
  METRIC_FLIGHT_SCHOOL_AI_STREAM_DELTA_COUNT,
  METRIC_FLIGHT_SCHOOL_AI_STREAM_TOOL_CALLS,
  METRIC_FLIGHT_SCHOOL_GITHUB_DURATION,
  METRIC_FLIGHT_SCHOOL_GITHUB_REQUESTS,
  METRIC_FLIGHT_SCHOOL_JOBS_QUEUE_WAIT,
  METRIC_GEN_AI_CLIENT_OPERATION_DURATION,
  METRIC_GEN_AI_CLIENT_TIME_TO_FIRST_CHUNK,
  METRIC_GEN_AI_CLIENT_TOKEN_USAGE,
} from './semconv';

type OperationStatus = 'ok' | 'error';
type StreamTerminalState = 'completed' | 'error' | 'cancelled';

interface TraceContext {
  traceId: string;
  spanId: string;
}

const tracer = trace.getTracer(INSTRUMENTATION_SCOPE_SERVER, INSTRUMENTATION_SCOPE_VERSION);
const meter = metrics.getMeter(INSTRUMENTATION_SCOPE_SERVER, INSTRUMENTATION_SCOPE_VERSION);

// ----- GenAI standard metrics (units: seconds, tokens) -----

const aiDurationHistogram = meter.createHistogram(METRIC_GEN_AI_CLIENT_OPERATION_DURATION, {
  description: 'Duration of AI client operations',
  unit: 's',
});

const aiTimeToFirstChunkHistogram = meter.createHistogram(METRIC_GEN_AI_CLIENT_TIME_TO_FIRST_CHUNK, {
  description: 'Latency from stream start to first chunk',
  unit: 's',
});

const aiTokenUsageHistogram = meter.createHistogram(METRIC_GEN_AI_CLIENT_TOKEN_USAGE, {
  description: 'Token usage per AI client operation, split by token type',
  unit: '{token}',
});

// ----- Flight-School custom metrics (units: seconds, counts, bytes) -----

const githubDurationHistogram = meter.createHistogram(METRIC_FLIGHT_SCHOOL_GITHUB_DURATION, {
  description: 'Duration of GitHub API operations',
  unit: 's',
});

const githubRequestCounter = meter.createCounter(METRIC_FLIGHT_SCHOOL_GITHUB_REQUESTS, {
  description: 'Count of GitHub API requests by outcome',
});

const aiStreamDeltaCountHistogram = meter.createHistogram(METRIC_FLIGHT_SCHOOL_AI_STREAM_DELTA_COUNT, {
  description: 'Number of delta chunks emitted per stream',
  unit: '{delta}',
});

const aiStreamDeltaBytesHistogram = meter.createHistogram(METRIC_FLIGHT_SCHOOL_AI_STREAM_DELTA_BYTES, {
  description: 'Total streamed bytes per stream',
  unit: 'By',
});

const aiStreamToolCallsCounter = meter.createCounter(METRIC_FLIGHT_SCHOOL_AI_STREAM_TOOL_CALLS, {
  description: 'Number of tool calls observed during streaming',
});

const jobQueueWaitHistogram = meter.createHistogram(METRIC_FLIGHT_SCHOOL_JOBS_QUEUE_WAIT, {
  description: 'Time between job capture and worker execution start',
  unit: 's',
});

function msToSeconds(ms: number): number {
  return ms / 1000;
}

function startSpan(name: string, attributes?: Attributes): Span {
  return tracer.startSpan(name, { attributes });
}

export function setSpanError(span: Span, error: unknown): void {
  let errorType = 'unknown';
  if (error instanceof Error) errorType = error.constructor.name;
  else if (typeof error === 'string') errorType = 'string';
  span.setAttribute('error.type', errorType);

  if (error instanceof Error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    return;
  }

  span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
}

export async function withSpan<T>(
  name: string,
  attributes: Attributes | undefined,
  operation: (span: Span) => Promise<T>,
): Promise<T> {
  const span = startSpan(name, attributes);
  try {
    const activeContext = trace.setSpan(context.active(), span);
    const result = await context.with(activeContext, () => operation(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    setSpanError(span, error);
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Records the duration of a single AI client operation. Called once per
 * operation (both streaming and non-streaming) on success or failure.
 *
 * @param operation - the GenAI operation kind (e.g. `'chat'`).
 * @param durationMs - operation duration in milliseconds; converted to
 *   seconds internally to match OTel GenAI semconv unit.
 * @param model - exact requested model name.
 * @param status - `'ok'` or `'error'`. Errors also carry an `error.type`
 *   attribute on the span — this function only records the histogram.
 */
export function recordAiOperation(
  operation: string,
  durationMs: number,
  model: string,
  status: OperationStatus,
): void {
  const attributes: Attributes = {
    [GEN_AI_OPERATION_NAME]: operation,
    [GEN_AI_REQUEST_MODEL]: model,
    [GEN_AI_PROVIDER_NAME]: GEN_AI_PROVIDER_GITHUB_COPILOT,
  };
  if (status === 'error') {
    // Coarse `error.type=unknown` keeps cardinality bounded when callers
    // don't have a typed error class to hand. Spans carry richer detail.
    attributes['error.type'] = 'unknown';
  }
  aiDurationHistogram.record(msToSeconds(durationMs), attributes);
}

export function recordGitHubOperation(
  route: string,
  durationMs: number,
  status: OperationStatus,
  statusCode?: number,
): void {
  const attributes: Attributes = {
    'github.route': route,
    'github.status': status,
  };
  if (statusCode !== undefined) {
    attributes['http.response.status_code'] = statusCode;
  }

  githubDurationHistogram.record(msToSeconds(durationMs), attributes);
  githubRequestCounter.add(1, attributes);
}

interface AiStreamMetricsInput {
  model: string;
  mcpEnabled: boolean;
  poolHit?: boolean | null;
  firstTokenMs: number | null;
  durationMs: number;
  deltaCount: number;
  deltaBytes: number;
  toolCalls: number;
  terminalState: StreamTerminalState;
}

/**
 * Records the post-flight metrics for a streaming AI operation. Emits one
 * GenAI standard metric (`gen_ai.client.operation.time_to_first_chunk`)
 * and several Flight-School custom metrics for delta count, bytes, and
 * tool calls.
 *
 * The operation-duration histogram is **not** emitted here — call
 * {@link recordAiOperation} separately so streaming and non-streaming
 * paths emit the same metric.
 */
export function recordAiStreamMetrics(input: AiStreamMetricsInput): void {
  const attributes: Attributes = {
    [GEN_AI_REQUEST_MODEL]: input.model,
    [GEN_AI_PROVIDER_NAME]: GEN_AI_PROVIDER_GITHUB_COPILOT,
    'ai.mcp_enabled': input.mcpEnabled,
    'ai.pool_hit': input.poolHit ?? 'unknown',
    'ai.stream.terminal_state': input.terminalState,
  };

  if (typeof input.firstTokenMs === 'number' && Number.isFinite(input.firstTokenMs)) {
    aiTimeToFirstChunkHistogram.record(msToSeconds(input.firstTokenMs), attributes);
  }
  aiStreamDeltaCountHistogram.record(input.deltaCount, attributes);
  aiStreamDeltaBytesHistogram.record(input.deltaBytes, attributes);
  aiStreamToolCallsCounter.add(input.toolCalls, attributes);
}

interface AiTokenUsageInput {
  model: string;
  operation: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/**
 * Records the {@link METRIC_GEN_AI_CLIENT_TOKEN_USAGE} histogram once per
 * non-zero token type. Skips undefined or zero values — emitting a zero
 * would skew percentile dashboards.
 */
export function recordAiTokenUsage(input: AiTokenUsageInput): void {
  const baseAttributes: Attributes = {
    [GEN_AI_OPERATION_NAME]: input.operation,
    [GEN_AI_REQUEST_MODEL]: input.model,
    [GEN_AI_PROVIDER_NAME]: GEN_AI_PROVIDER_GITHUB_COPILOT,
  };

  const entries: Array<[string, number | undefined]> = [
    [GEN_AI_TOKEN.INPUT, input.inputTokens],
    [GEN_AI_TOKEN.OUTPUT, input.outputTokens],
    [GEN_AI_TOKEN.CACHE_READ, input.cacheReadTokens],
    [GEN_AI_TOKEN.CACHE_WRITE, input.cacheWriteTokens],
  ];

  for (const [tokenType, value] of entries) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    aiTokenUsageHistogram.record(value, {
      ...baseAttributes,
      [GEN_AI_TOKEN_TYPE]: tokenType,
    });
  }
}

export function recordJobQueueWait(durationMs: number, jobType: string): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;

  jobQueueWaitHistogram.record(msToSeconds(durationMs), {
    'job.type': jobType,
  });
}

export function getActiveTraceContext(): TraceContext | null {
  const span = trace.getSpan(context.active());
  const spanContext = span?.spanContext();
  if (!spanContext) return null;
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  };
}

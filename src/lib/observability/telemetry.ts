import {
  context,
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api';

type OperationStatus = 'ok' | 'error';
type StreamTerminalState = 'completed' | 'error' | 'cancelled';

interface TraceContext {
  traceId: string;
  spanId: string;
}

const tracer = trace.getTracer('flight-school');
const meter = metrics.getMeter('flight-school');

const aiDurationHistogram = meter.createHistogram('flight_school.ai.duration_ms', {
  description: 'Duration of AI operations',
  unit: 'ms',
});

const githubDurationHistogram = meter.createHistogram('flight_school.github.duration_ms', {
  description: 'Duration of GitHub API operations',
  unit: 'ms',
});

const aiOperationCounter = meter.createCounter('flight_school.ai.operations', {
  description: 'Count of AI operations by outcome',
});

const githubRequestCounter = meter.createCounter('flight_school.github.requests', {
  description: 'Count of GitHub API requests by outcome',
});

const aiStreamFirstTokenHistogram = meter.createHistogram('flight_school.ai.stream.first_token_ms', {
  description: 'Latency from stream start to first token',
  unit: 'ms',
});

const aiStreamDurationHistogram = meter.createHistogram('flight_school.ai.stream.duration_ms', {
  description: 'Total streaming duration',
  unit: 'ms',
});

const aiStreamDeltaCountHistogram = meter.createHistogram('flight_school.ai.stream.delta_count', {
  description: 'Number of delta chunks emitted per stream',
});

const aiStreamDeltaBytesHistogram = meter.createHistogram('flight_school.ai.stream.delta_bytes', {
  description: 'Total streamed bytes per stream',
  unit: 'By',
});

const aiStreamToolCallsCounter = meter.createCounter('flight_school.ai.stream.tool_calls', {
  description: 'Number of tool calls observed during streaming',
});

const jobQueueWaitHistogram = meter.createHistogram('flight_school.jobs.queue_wait_ms', {
  description: 'Time between job capture and worker execution start',
  unit: 'ms',
});

function startSpan(name: string, attributes?: Attributes): Span {
  return tracer.startSpan(name, {
    attributes,
  });
}

export function setSpanError(span: Span, error: unknown): void {
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
  operation: (span: Span) => Promise<T>
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

export function recordAiOperation(
  operation: string,
  durationMs: number,
  model: string,
  status: OperationStatus
): void {
  const attributes = {
    'ai.operation': operation,
    'ai.model': model,
    'ai.status': status,
  };
  aiDurationHistogram.record(durationMs, attributes);
  aiOperationCounter.add(1, attributes);
}

export function recordGitHubOperation(
  route: string,
  durationMs: number,
  status: OperationStatus,
  statusCode?: number
): void {
  const attributes: Attributes = {
    'github.route': route,
    'github.status': status,
  };
  if (statusCode !== undefined) {
    attributes['http.status_code'] = statusCode;
  }

  githubDurationHistogram.record(durationMs, attributes);
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

export function recordAiStreamMetrics(input: AiStreamMetricsInput): void {
  const attributes: Attributes = {
    'ai.model': input.model,
    'ai.mcp_enabled': input.mcpEnabled,
    'ai.pool_hit': input.poolHit ?? 'unknown',
    'ai.stream.terminal_state': input.terminalState,
  };

  if (typeof input.firstTokenMs === 'number' && Number.isFinite(input.firstTokenMs)) {
    aiStreamFirstTokenHistogram.record(input.firstTokenMs, attributes);
  }
  aiStreamDurationHistogram.record(input.durationMs, attributes);
  aiStreamDeltaCountHistogram.record(input.deltaCount, attributes);
  aiStreamDeltaBytesHistogram.record(input.deltaBytes, attributes);
  aiStreamToolCallsCounter.add(input.toolCalls, attributes);
}

export function recordJobQueueWait(durationMs: number, jobType: string): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return;
  }

  jobQueueWaitHistogram.record(durationMs, {
    'job.type': jobType,
  });
}

export function getActiveTraceContext(): TraceContext | null {
  const span = trace.getSpan(context.active());
  const spanContext = span?.spanContext();
  if (!spanContext) {
    return null;
  }
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  };
}

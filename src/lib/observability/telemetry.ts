import {
  context,
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api';

type OperationStatus = 'ok' | 'error';

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

export function startSpan(name: string, attributes?: Attributes): Span {
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

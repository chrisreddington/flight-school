/**
 * Client-side helper that emits a discrete `page.navigation` span on every
 * App Router pathname change. Useful for measuring "user navigated to X" as
 * a standalone event in traces.
 */

import { trace } from '@opentelemetry/api';

import {
  INSTRUMENTATION_SCOPE_BROWSER,
  INSTRUMENTATION_SCOPE_VERSION,
} from './semconv';

export function recordNavigation(path: string, previousPath: string | undefined): void {
  const tracer = trace.getTracer(INSTRUMENTATION_SCOPE_BROWSER, INSTRUMENTATION_SCOPE_VERSION);
  const span = tracer.startSpan('page.navigation', {});
  span.setAttribute('page.path', path);
  if (previousPath !== undefined) {
    span.setAttribute('page.previous_path', previousPath);
  }
  span.end();
}

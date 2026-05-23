/**
 * Browser-side OpenTelemetry bootstrap.
 *
 * Initialises a {@link WebTracerProvider} that auto-instruments document load
 * and outbound `fetch` calls. The W3C `traceparent` header is injected on
 * same-origin fetches so server-side spans become children of the browser
 * span tree, joining frontend and backend into a single trace per page load.
 *
 * Spans are exported to `/api/otel/v1/traces` — a same-origin auth-gated
 * proxy that forwards to the configured upstream OTLP collector. This avoids
 * browser-CORS configuration on the collector itself.
 */

import { ZoneContextManager } from '@opentelemetry/context-zone';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, WebTracerProvider } from '@opentelemetry/sdk-trace-web';

import { stripQueryString } from '@/lib/observability/url-sanitize';

const PROXY_URL = '/api/otel/v1/traces';
const SERVICE_NAME = 'flight-school-browser';

let initialised = false;

export function initBrowserOtel(): void {
  if (initialised) return;
  initialised = true;

  const exporter = new OTLPTraceExporter({ url: PROXY_URL });

  const provider = new WebTracerProvider({
    resource: defaultResource().merge(
      resourceFromAttributes({ 'service.name': SERVICE_NAME }),
    ),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  } as ConstructorParameters<typeof WebTracerProvider>[0]);

  provider.register({
    contextManager: new ZoneContextManager(),
  });

  registerInstrumentations({
    instrumentations: [
      new DocumentLoadInstrumentation(),
      new FetchInstrumentation({
        // Never instrument our own export path — it would cause recursive
        // self-tracing and a feedback loop with the BatchSpanProcessor.
        ignoreUrls: [/\/api\/otel\/v1\/traces/],
        clearTimingResources: true,
        // Strip query strings from URL-shaped span attributes so we never
        // leak tokens, ids, or search terms into the trace backend.
        applyCustomAttributesOnSpan: (span, request) => {
          const url =
            typeof request === 'string'
              ? request
              : 'url' in request && typeof request.url === 'string'
                ? request.url
                : undefined;
          if (url) {
            span.setAttribute('http.url', stripQueryString(url));
          }
        },
      }),
    ],
  });
}

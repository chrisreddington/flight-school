/**
 * Browser-side OpenTelemetry bootstrap.
 *
 * Initialises a {@link WebTracerProvider} that auto-instruments document load
 * and outbound `fetch` calls. The W3C `traceparent` header is injected on
 * same-origin fetches so server-side spans become children of the browser
 * span tree, joining frontend and backend into a single trace per page load.
 *
 * Spans are exported to same-origin proxy routes:
 * - `/api/otel/v1/traces` when an Auth.js session cookie is present
 * - `/api/otel/v1/traces/anonymous` before authentication
 *
 * Both routes forward to the configured upstream OTLP collector. This avoids
 * browser-CORS configuration on the collector itself.
 *
 * # `page.view` parent span
 *
 * In addition to the standard instrumentation, this module manages a
 * route-bounded `page.view` span (see `route-tracking.ts`) and wraps
 * `window.fetch` so each request is issued inside a context where that
 * span is active. The result: all browser fetches issued from a given
 * route share a common parent in the trace tree.
 *
 * The wrap is installed *after* `registerInstrumentations` so it sits
 * outside the `FetchInstrumentation` patch — our wrapper runs first, sets
 * the active context, then delegates to the instrumented fetch, which in
 * turn reads `context.active()` when constructing the CLIENT span.
 */

import { context, trace } from '@opentelemetry/api';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, WebTracerProvider } from '@opentelemetry/sdk-trace-web';

import { INSTRUMENTATION_SCOPE_VERSION } from '@/lib/observability/semconv';
import { stripQueryString, extractPathname } from '@/lib/observability/url-sanitize';

import { getCurrentPageView, installRouteTracking, startPageView } from './route-tracking';

const AUTHENTICATED_PROXY_URL = '/api/otel/v1/traces';
const ANONYMOUS_PROXY_URL = '/api/otel/v1/traces/anonymous';
const AUTH_SESSION_COOKIE_NAMES = ['__Secure-authjs.session-token', 'authjs.session-token'] as const;
const SERVICE_NAME = 'flight-school-browser';
const FETCH_WRAPPED_MARKER = Symbol.for('flight-school.browser-otel.fetch-wrapped');

type WrappedFetch = typeof window.fetch & {
  [FETCH_WRAPPED_MARKER]?: true;
};

let initialised = false;

function hasAuthSessionCookie(): boolean {
  const cookie = document.cookie;
  if (!cookie) return false;
  const parts = cookie.split(';').map((part) => part.trim());
  return AUTH_SESSION_COOKIE_NAMES.some((cookieName) => parts.some((part) => part.startsWith(`${cookieName}=`)));
}

export function initBrowserOtel(): void {
  if (initialised) return;
  initialised = true;

  const exporter = new OTLPTraceExporter({
    url: hasAuthSessionCookie() ? AUTHENTICATED_PROXY_URL : ANONYMOUS_PROXY_URL,
    // `keepalive: true` lets the browser deliver the final batch even
    // after the tab is closing or navigating away. Without this, the
    // last page.view span and any pending children are routinely lost
    // on unload because the unload-triggered fetch is cancelled.
    fetchOptions: { keepalive: true },
  } as ConstructorParameters<typeof OTLPTraceExporter>[0]);

  const processor = new BatchSpanProcessor(exporter);

  const provider = new WebTracerProvider({
    resource: defaultResource().merge(
      resourceFromAttributes({
        'service.name': SERVICE_NAME,
        'service.version': INSTRUMENTATION_SCOPE_VERSION,
      }),
    ),
    spanProcessors: [processor],
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
        // Also skip the long-lived SSE stream endpoint: FetchInstrumentation
        // clones the response and reads the clone to completion to close
        // its span, which can interfere with incremental delivery of chat
        // tokens on some runtimes. The worker emits its own server-side
        // spans for the chat session, so we don't lose observability.
        ignoreUrls: [/\/api\/otel\/v1\/traces/, /\/api\/jobs\/[^/]+\/stream(?:\?|$)/],
        clearTimingResources: true,
        // Strip query strings from URL-shaped span attributes so we never
        // leak tokens, ids, or search terms into the trace backend.
        // Also rename the span from the generic "HTTP GET" default to
        // "GET /api/foo" so the trace list is scannable.
        applyCustomAttributesOnSpan: (span, request) => {
          const requestUrl = extractRequestUrl(request);
          if (!requestUrl) return;
          const sanitizedUrl = stripQueryString(requestUrl);
          const requestMethod = extractRequestMethod(request);
          span.setAttribute('http.url', sanitizedUrl);
          span.updateName(`${requestMethod} ${extractPathname(sanitizedUrl)}`);
        },
      }),
    ],
  });

  // Start the first `page.view` span SYNCHRONOUSLY against the current
  // pathname, before any React effect has had a chance to fire (and
  // therefore before any child component can issue a fetch). This is the
  // critical ordering guarantee that makes mount-time fetches inherit a
  // parent. Subsequent navigation is handled by `installRouteTracking`.
  if (typeof window !== 'undefined') {
    startPageView(window.location.pathname);
    installRouteTracking(() => {
      void processor.forceFlush().catch(() => {
        // Best effort during unload — there's nothing we can do if the
        // flush fails, and a thrown promise here would only pollute
        // window error handlers.
      });
    });
    wrapWindowFetch();
  }
}

/**
 * Pulls the URL string from any of the shapes `fetch()` accepts —
 * a string, a `URL`, or a `Request`. Returns `undefined` when none of
 * the shapes carry a usable URL.
 */
function extractRequestUrl(request: Request | RequestInit): string | undefined {
  if ('url' in request && typeof request.url === 'string') return request.url;
  return undefined;
}

/**
 * Returns the uppercase HTTP method for a `fetch()` argument. Defaults
 * to `GET` when no explicit method is supplied.
 */
function extractRequestMethod(request: Request | RequestInit): string {
  if (typeof request.method !== 'string') return 'GET';
  return request.method.toUpperCase();
}

/**
 * Installs an outer wrapper around `window.fetch` so each call runs with
 * the current `page.view` span active in the OTel context. The wrapper
 * is idempotent across HMR reloads via a `Symbol.for` marker — a second
 * call is a no-op.
 *
 * Ordering matters: this must be invoked AFTER `registerInstrumentations`,
 * so `FetchInstrumentation` has already wrapped `window.fetch` with its
 * own patch. Our wrapper then sits outside that patch and sets the active
 * context before the inner patched fetch runs `startSpan`.
 */
function wrapWindowFetch(): void {
  const currentFetch = window.fetch as WrappedFetch;
  if (currentFetch[FETCH_WRAPPED_MARKER]) return;

  const instrumentedFetch = currentFetch.bind(window);
  const pageViewAwareFetch: WrappedFetch = function flightSchoolFetch(
    this: typeof window,
    ...args: Parameters<typeof window.fetch>
  ) {
    const pageSpan = getCurrentPageView();
    if (!pageSpan) {
      return instrumentedFetch(...args);
    }
    const contextWithPageSpan = trace.setSpan(context.active(), pageSpan);
    return context.with(contextWithPageSpan, () => instrumentedFetch(...args));
  } as WrappedFetch;
  pageViewAwareFetch[FETCH_WRAPPED_MARKER] = true;
  window.fetch = pageViewAwareFetch;
}

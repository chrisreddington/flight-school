/**
 * Route-bounded "page view" span lifecycle for the browser-side OTel SDK.
 *
 * # Why this exists
 *
 * Each `fetch()` call in the browser produces a CLIENT span via the
 * `FetchInstrumentation` package. By default, that span has no parent — it
 * becomes its own root trace. A dashboard mount with eleven parallel API
 * calls therefore produces eleven separate root traces in the Aspire trace
 * list, which is unreadable and obscures cross-request causality.
 *
 * The fix is a long-lived `page.view` span that is **active** in the OTel
 * context for the duration of a single route. The `FetchInstrumentation`
 * reads `context.active()` synchronously inside `tracer.startSpan(...)`, so
 * if our page span is active, every fetch CLIENT span gets it as a parent.
 *
 * # Why we cannot drive this from React
 *
 * React's effect-execution model fires child effects **before** parent
 * effects, on both first mount and route changes. A `useEffect` in the root
 * layout that listens for `usePathname` therefore runs *after* the page's
 * data-fetching children have already dispatched their requests. Worse, on
 * an A→B navigation the layout's effect updates `currentPageSpan` only
 * after B's children have already fetched — meaning B's fetches would be
 * mis-parented to A's span.
 *
 * We side-step the React lifecycle entirely by patching `history.pushState`
 * and `history.replaceState`, and listening for `popstate`. These fire
 * synchronously when the App Router updates the URL, before any
 * re-render. Combined with a span started synchronously during browser
 * OTel bootstrap (against `window.location.pathname`), we cover both first
 * load and subsequent navigation.
 *
 * # Lifecycle
 *
 * - First span starts during `initBrowserOtel()` against the initial
 *   pathname, synchronously, before any React effect can fire.
 * - On every `pushState`/`replaceState`/`popstate` we end the current span
 *   and start a new one against the new pathname.
 * - On `pagehide` we end the current span and `forceFlush()` the span
 *   processor. We deliberately use `pagehide` (not `beforeunload`) because
 *   mobile browsers don't fire `beforeunload` reliably, and `pagehide` is
 *   the modern Page Lifecycle API equivalent.
 * - On `visibilitychange === 'hidden'` we only `forceFlush()` — the user
 *   may return to the tab, so we keep the span open.
 *
 * # Idempotency
 *
 * The patch hooks must not be re-installed across HMR cycles in dev (which
 * would cause duplicate spans). We mark patched functions with a `Symbol`
 * and bail out if it is already present.
 */

import { trace, type Span, type Tracer } from '@opentelemetry/api';

import { INSTRUMENTATION_SCOPE_BROWSER, INSTRUMENTATION_SCOPE_VERSION } from './semconv';

const PATCH_MARKER = Symbol.for('flight-school.route-tracking.patched');

type Patchable = ((...args: unknown[]) => unknown) & {
  [PATCH_MARKER]?: true;
};

let currentSpan: Span | undefined;
let currentPath: string | undefined;
let installed = false;
let originalPushState: History['pushState'] | undefined;
let originalReplaceState: History['replaceState'] | undefined;

function tracer(): Tracer {
  return trace.getTracer(INSTRUMENTATION_SCOPE_BROWSER, INSTRUMENTATION_SCOPE_VERSION);
}

/**
 * Starts a fresh `page.view` span and stores it as the module-level
 * "current" span. Any previously-active span is ended first. The previous
 * pathname is attached as an attribute when transitioning between routes.
 */
export function startPageView(pathname: string): Span {
  const previousPath = currentPath;
  endCurrentPageView();
  const span = tracer().startSpan('page.view', {
    attributes: {
      'page.path': pathname,
      ...(previousPath !== undefined && { 'page.previous_path': previousPath }),
    },
  });
  currentSpan = span;
  currentPath = pathname;
  return span;
}

/**
 * Ends the current `page.view` span if one exists. Safe to call when no
 * span is active.
 */
export function endCurrentPageView(): void {
  if (currentSpan) {
    currentSpan.end();
    currentSpan = undefined;
  }
}

/**
 * Returns the currently-active `page.view` span (if any). Used by the
 * fetch wrapper in `browser-otel.ts` to set it as the parent context for
 * outbound requests.
 */
export function getCurrentPageView(): Span | undefined {
  return currentSpan;
}

/**
 * Installs `history` patches and `pagehide` / `visibilitychange` listeners
 * that drive the `page.view` span lifecycle in response to browser
 * navigation events. Safe to call repeatedly; subsequent calls are no-ops.
 *
 * Caller is responsible for starting the *initial* page span — this
 * function only handles navigation transitions.
 *
 * @param onLifecycleEvent Called on `pagehide` and on
 *   `visibilitychange === 'hidden'`. The bootstrap module uses this to
 *   trigger a `forceFlush` on the span processor so any pending spans are
 *   exported before the browser tears the page down.
 */
export function installRouteTracking(onLifecycleEvent: () => void): void {
  if (installed) return;
  if (typeof window === 'undefined') return;
  installed = true;

  patchHistoryMethod('pushState');
  patchHistoryMethod('replaceState');

  window.addEventListener('popstate', handleNavigation);
  window.addEventListener('pagehide', () => {
    endCurrentPageView();
    onLifecycleEvent();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      onLifecycleEvent();
    }
  });
}

function patchHistoryMethod(method: 'pushState' | 'replaceState'): void {
  const original = window.history[method] as Patchable;
  if (original[PATCH_MARKER]) return;

  if (method === 'pushState') originalPushState = window.history.pushState;
  else originalReplaceState = window.history.replaceState;

  const patched: Patchable = function patched(this: History, ...args: Parameters<History[typeof method]>) {
    const result = original.apply(this, args);
    handleNavigation();
    return result;
  } as Patchable;
  patched[PATCH_MARKER] = true;
  window.history[method] = patched as unknown as History[typeof method];
}

function handleNavigation(): void {
  if (typeof window === 'undefined') return;
  const pathname = window.location.pathname;
  if (currentPath === pathname) return; // no-op for same-path replaceState
  startPageView(pathname);
}

/**
 * Test-only reset. Clears module state AND restores the native
 * `history.pushState` / `history.replaceState` so subsequent test
 * imports start from a clean baseline. Not used in production.
 */
export function __resetRouteTrackingForTests(): void {
  endCurrentPageView();
  currentPath = undefined;
  installed = false;
  if (typeof window !== 'undefined') {
    if (originalPushState) {
      window.history.pushState = originalPushState;
      originalPushState = undefined;
    }
    if (originalReplaceState) {
      window.history.replaceState = originalReplaceState;
      originalReplaceState = undefined;
    }
  }
}

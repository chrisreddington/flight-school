/**
 * Shared HTTP primitive for server-to-worker calls.
 *
 * Every server-side caller of the Copilot worker resolves the same env
 * configuration, applies the same shared-secret authorization header, and
 * propagates the same W3C trace headers. This module owns that boilerplate
 * so the per-endpoint clients can read like the protocol they implement.
 *
 * Not used by {@link executeCopilotChatViaWorker} (in `./http-client.ts`),
 * which adds an explicit abort/timeout controller for the chat request — a
 * concern that does not apply to the short-lived control-plane endpoints
 * covered here.
 */

import 'server-only';

import {
  mergeTracePropagationHeaders,
  type TracePropagationHeaders,
} from '@/lib/observability/context-propagation';

import { getCopilotWorkerConfig, type CopilotWorkerConfig } from './config';

export interface WorkerFetchOptions {
  /** Human-readable suffix for error messages (e.g. `'job create'`). */
  errorContext: string;
  /** Optional W3C trace propagation headers to forward to the worker. */
  traceContext?: TracePropagationHeaders;
  /** Returns `null` instead of throwing on 404 (callers map this to "not found"). */
  allowNotFound?: boolean;
}

/**
 * Worker configuration accessor. Throws when the worker is not configured;
 * the application is mandatory-worker for any server-to-worker control call.
 */
export function getRequiredWorkerConfig(context = 'this operation'): CopilotWorkerConfig {
  const config = getCopilotWorkerConfig();
  if (!config) {
    throw new Error(`Copilot worker is required for ${context}`);
  }
  return config;
}

/**
 * Issue an authenticated, trace-propagating request to the Copilot worker
 * and return the response. Throws on transport errors and non-OK responses,
 * unless `allowNotFound` is set, in which case a 404 returns `null`.
 *
 * The caller is responsible for parsing the response body (JSON, text,
 * stream); this helper deliberately stays at the HTTP layer so endpoints
 * with unusual payload shapes — empty bodies, NDJSON, SSE — are not
 * coerced through a single deserializer.
 */
export async function workerFetch(
  path: string,
  init: RequestInit,
  opts: WorkerFetchOptions,
): Promise<Response | null> {
  const config = getRequiredWorkerConfig(opts.errorContext);
  const headers = mergeTracePropagationHeaders(
    {
      authorization: `Bearer ${config.secret}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
    opts.traceContext ?? {},
  );

  const response = await fetch(`${config.baseUrl}${path}`, { ...init, headers, cache: 'no-store' });

  if (opts.allowNotFound && response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Copilot worker ${opts.errorContext} failed with HTTP ${response.status}`);
  }
  return response;
}

/**
 * Convenience wrapper for the common JSON-in / JSON-out case. Returns the
 * parsed body as `T`. Use {@link workerFetch} directly for endpoints that
 * return empty bodies, NDJSON, or other non-JSON shapes.
 */
export async function workerFetchJson<T>(
  path: string,
  init: RequestInit,
  opts: WorkerFetchOptions,
): Promise<T | null> {
  const response = await workerFetch(path, init, opts);
  if (response === null) return null;
  return (await response.json()) as T;
}

/**
 * Centralized API client for consistent error handling and request patterns.
 * 
 * Features:
 * - Automatic retry with exponential backoff
 * - Request deduplication for GET requests
 * - Configurable timeouts
 * - Type-safe error handling
 * 
 * @example
 * ```typescript
 * const profile = await apiGet<ProfileResponse>('/api/profile');
 * const data = await apiPost<CreateResponse>('/api/create', { name: 'test' });
 * ```
 */

import {
  COPILOT_REQUIRED_EVENT,
  type CopilotRequiredEventDetail,
} from '@/lib/copilot/required-event';
import {
  encodeClientTriggerHeaders,
  type ClientTriggerMetadata,
} from '@/lib/observability/trigger-metadata';
import {
  dispatchRateLimited,
  RateLimitedClientError,
} from '@/lib/api/rate-limit-event';
import { signOut } from 'next-auth/react';

interface ApiRequestOptions extends RequestInit {
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Number of retry attempts (default: 0) */
  retries?: number;
  /** Whether to throw on HTTP errors (default: true) */
  throwOnError?: boolean;
  /** Optional client trigger metadata for observability correlation. */
  clientTrigger?: ClientTriggerMetadata;
}

/**
 * Custom error class for API failures with status code and context.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Dispatch the `copilot-required` window event so the global banner can
 * surface a 402 from any fetch site.
 */
function dispatchCopilotRequired(
  body: unknown,
  endpoint: string,
): CopilotRequiredEventDetail {
  const detail: CopilotRequiredEventDetail = {
    message:
      body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : undefined,
    signUpUrl:
      body && typeof body === 'object' && typeof (body as { signUpUrl?: unknown }).signUpUrl === 'string'
        ? (body as { signUpUrl: string }).signUpUrl
        : undefined,
    endpoint,
  };
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(COPILOT_REQUIRED_EVENT, { detail }));
  }
  return detail;
}

/**
 * True when a 402 body has the `copilot_required` shape AI routes return.
 */
function isCopilotRequiredBody(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { error?: unknown }).error === 'copilot_required'
  );
}

async function redirectToSignInAfterAuthFailure(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (window.location.pathname === '/sign-in') return;

  await signOut({ redirect: false });
  const callbackPath = `${window.location.pathname}${window.location.search}`;
  const signInUrl = `/sign-in?callbackUrl=${encodeURIComponent(callbackPath || '/')}`;
  window.location.assign(signInUrl);
}

// Request deduplication cache for GET requests
const pendingRequests = new Map<string, Promise<unknown>>();

/** Generates a cache key for request deduplication. */
function getCacheKey(url: string, options?: ApiRequestOptions): string {
  const method = options?.method ?? 'GET';
  const body = options?.body ? String(options.body) : '';
  return `${method}:${url}:${body}`;
}

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const normalized: Record<string, string> = {};
    headers.forEach((value, key) => {
      normalized[key] = value;
    });
    return normalized;
  }
  if (Array.isArray(headers)) {
    const normalized: Record<string, string> = {};
    for (const [key, value] of headers) {
      normalized[key] = value;
    }
    return normalized;
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== 'string') continue;
    normalized[key] = value;
  }
  return normalized;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const wanted = name.toLowerCase();
  return Object.keys(headers).some((header) => header.toLowerCase() === wanted);
}

function buildRequestHeaders(
  headers: HeadersInit | undefined,
  clientTrigger: ClientTriggerMetadata | undefined,
): Record<string, string> {
  const merged = normalizeHeaders(headers);
  if (!hasHeader(merged, 'content-type')) {
    merged['Content-Type'] = 'application/json';
  }
  if (!clientTrigger) {
    return merged;
  }

  return {
    ...merged,
    ...encodeClientTriggerHeaders(clientTrigger),
  };
}

/**
 * Core API request function with retry, timeout, and deduplication.
 */
async function apiRequest<T>(
  url: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const {
    timeout = 30000,
    retries = 0,
    throwOnError = true,
    signal: externalSignal,
    clientTrigger,
    ...fetchOptions
  } = options;

  const cacheKey = getCacheKey(url, options);
  const method = options.method ?? 'GET';
  
  // Return cached promise for duplicate GET requests
  if (method === 'GET') {
    const pending = pendingRequests.get(cacheKey);
    if (pending) {
      return pending as Promise<T>;
    }
  }

  // Create abort controller for timeout
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeout);

  // Create a combined signal if external signal is provided
  let combinedSignal = timeoutController.signal;
  if (externalSignal) {
    // If external signal already aborted, abort immediately
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      throw new DOMException('Aborted', 'AbortError');
    }
    // Listen to external abort
    externalSignal.addEventListener('abort', () => {
      timeoutController.abort();
    });
    combinedSignal = timeoutController.signal;
  }

  const requestPromise = (async () => {
    try {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const response = await fetch(url, {
            ...fetchOptions,
            signal: combinedSignal,
            // Keep the request alive even during navigation - critical for background operations
            keepalive: true,
            cache: 'no-store',
            headers: buildRequestHeaders(fetchOptions.headers, clientTrigger),
          });

          clearTimeout(timeoutId);

          const data = await response.json().catch(() => ({}));

          // F4: 402 + `copilot_required` → broadcast so the global banner
          // can react without each call site having to handle it.
          if (response.status === 402 && isCopilotRequiredBody(data)) {
            dispatchCopilotRequired(data, url);
          }

          if (response.status === 401) {
            await redirectToSignInAfterAuthFailure();
          }

          // F5: 429 → broadcast so the global rate-limit toast/hook can
          // react without each call site having to handle it.
          if (response.status === 429) {
            const detail = dispatchRateLimited(response, data, url);
            if (throwOnError) {
              throw new RateLimitedClientError(detail);
            }
            return data as T;
          }

          if (!response.ok) {
            const errorMessage = data.error || `HTTP ${response.status}`;
            if (throwOnError) {
              // Surface body-level fields (e.g. `code`, `windowSeconds`) on
              // the error context so call sites can branch on them without
              // having to re-parse the response.
              const context = {
                ...(data.meta && typeof data.meta === 'object' ? data.meta : {}),
                ...(typeof data === 'object' && data !== null
                  ? Object.fromEntries(
                      Object.entries(data).filter(
                        ([k]) => k !== 'error' && k !== 'meta',
                      ),
                    )
                  : {}),
              };
              throw new ApiError(errorMessage, response.status, context);
            }
            return data as T;
          }

          return data as T;
        } catch (error) {
          lastError = error as Error;

          // Don't retry on abort or client errors (4xx)
          if (
            error instanceof Error &&
            (error.name === 'AbortError' ||
              ((error as ApiError).status >= 400 &&
                (error as ApiError).status < 500))
          ) {
            throw error;
          }

          // Retry with exponential backoff
          if (attempt < retries) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      throw lastError || new Error('Request failed');
    } finally {
      clearTimeout(timeoutId);
      if (method === 'GET') {
        pendingRequests.delete(cacheKey);
      }
    }
  })();

  if (method === 'GET') {
    pendingRequests.set(cacheKey, requestPromise);
  }

  return requestPromise;
}

/**
 * Performs a GET request with automatic retry and deduplication.
 *
 * @param url - API endpoint URL
 * @param options - Request options (timeout, retries, throwOnError)
 * @returns Promise resolving to the typed API response
 */
export function apiGet<T>(
  url: string,
  options?: Omit<ApiRequestOptions, 'method' | 'body'>
): Promise<T> {
  return apiRequest<T>(url, { ...options, method: 'GET' });
}

/**
 * Perform a POST request.
 * 
 * @param url - API endpoint URL
 * @param data - Request body data
 * @param options - Request options
 * @returns Promise resolving to the API response
 */
export function apiPost<T>(
  url: string,
  data?: unknown,
  options?: Omit<ApiRequestOptions, 'method' | 'body'>
): Promise<T> {
  return apiRequest<T>(url, {
    ...options,
    method: 'POST',
    body: data ? JSON.stringify(data) : undefined,
  });
}

/**
 * Performs a DELETE request.
 *
 * @param url - API endpoint URL
 * @param options - Request options (timeout, retries, throwOnError)
 * @returns Promise resolving to the typed API response
 */
export function apiDelete<T>(
  url: string,
  options?: Omit<ApiRequestOptions, 'method'>
): Promise<T> {
  return apiRequest<T>(url, { ...options, method: 'DELETE' });
}

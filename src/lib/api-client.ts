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

export interface ApiRequestOptions extends RequestInit {
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Number of retry attempts (default: 0) */
  retries?: number;
  /** Whether to throw on HTTP errors (default: true) */
  throwOnError?: boolean;
}

/**
 * Custom error class for API failures with status code and context.
 */
class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Request deduplication cache for GET requests
const pendingRequests = new Map<string, Promise<unknown>>();

/** Generates a cache key for request deduplication. */
function getCacheKey(url: string, options?: ApiRequestOptions): string {
  const method = options?.method ?? 'GET';
  const body = options?.body ? String(options.body) : '';
  return `${method}:${url}:${body}`;
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const requestPromise = (async () => {
    try {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const response = await fetch(url, {
            ...fetchOptions,
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              ...fetchOptions.headers,
            },
          });

          clearTimeout(timeoutId);

          const data = await response.json().catch(() => ({}));

          if (!response.ok) {
            const errorMessage = data.error || `HTTP ${response.status}`;
            if (throwOnError) {
              throw new ApiError(errorMessage, response.status, data.meta);
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
 * Perform a PATCH request.
 * 
 * @param url - API endpoint URL
 * @param data - Request body data
 * @param options - Request options
 * @returns Promise resolving to the API response
 */
export function apiPatch<T>(
  url: string,
  data?: unknown,
  options?: Omit<ApiRequestOptions, 'method' | 'body'>
): Promise<T> {
  return apiRequest<T>(url, {
    ...options,
    method: 'PATCH',
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

/**
 * Tests for API client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiGet, apiPost, apiPatch, apiDelete } from './api-client';

// =============================================================================
// Setup
// =============================================================================

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ===========================================================================
  // apiGet Tests
  // ===========================================================================

  describe('apiGet', () => {
    it('should make GET request to the provided URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: 'test' }),
      });

      const result = await apiGet('/api/test');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
      expect(result).toEqual({ data: 'test' });
    });

    it('should handle JSON parse errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      const result = await apiGet('/api/test');

      expect(result).toEqual({});
    });
  });

  // ===========================================================================
  // apiPost Tests
  // ===========================================================================

  describe('apiPost', () => {
    it('should make POST request with body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ created: true }),
      });

      const result = await apiPost('/api/create', { name: 'test' });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/create',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'test' }),
        })
      );
      expect(result).toEqual({ created: true });
    });

    it('should handle POST without body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      await apiPost('/api/trigger');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/trigger',
        expect.objectContaining({
          method: 'POST',
          body: undefined,
        })
      );
    });
  });

  // ===========================================================================
  // apiPatch Tests
  // ===========================================================================

  describe('apiPatch', () => {
    it('should make PATCH request with body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ updated: true }),
      });

      const result = await apiPatch('/api/update/1', { name: 'updated' });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/update/1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: 'updated' }),
        })
      );
      expect(result).toEqual({ updated: true });
    });
  });

  // ===========================================================================
  // apiDelete Tests
  // ===========================================================================

  describe('apiDelete', () => {
    it('should make DELETE request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ deleted: true }),
      });

      const result = await apiDelete('/api/delete/1');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/delete/1',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
      expect(result).toEqual({ deleted: true });
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('error handling', () => {
    it('should throw ApiError for HTTP errors when throwOnError is true', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'Not found' }),
      });

      await expect(apiGet('/api/missing')).rejects.toThrow('Not found');
    });

    it('should return error data when throwOnError is false', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Bad request', meta: {} }),
      });

      const result = await apiGet('/api/bad', { throwOnError: false });

      expect(result).toEqual({ error: 'Bad request', meta: {} });
    });

    it('should use HTTP status as error message when error field missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

      await expect(apiGet('/api/error')).rejects.toThrow('HTTP 500');
    });
  });

  // ===========================================================================
  // Retry Logic Tests
  // ===========================================================================

  describe('retry logic', () => {
    it('should retry on server errors', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });

      const resultPromise = apiGet('/api/flaky', { retries: 1 });

      // Advance timers for exponential backoff
      await vi.advanceTimersByTimeAsync(1000);

      const result = await resultPromise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true });
    });

    it('should not retry on 4xx client errors', async () => {
      const clientError = new Error('Bad request') as Error & { status: number };
      clientError.status = 400;

      mockFetch.mockRejectedValueOnce(clientError);

      await expect(apiGet('/api/bad', { retries: 3 })).rejects.toThrow();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should use exponential backoff between retries', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Server error'))
        .mockRejectedValueOnce(new Error('Server error'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });

      const resultPromise = apiGet('/api/flaky', { retries: 2 });

      // First retry after 1000ms
      await vi.advanceTimersByTimeAsync(1000);
      // Second retry after 2000ms
      await vi.advanceTimersByTimeAsync(2000);

      const result = await resultPromise;

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ success: true });
    });
  });

  // ===========================================================================
  // Request Deduplication Tests
  // ===========================================================================

  describe('request deduplication', () => {
    it('should deduplicate concurrent GET requests', async () => {
      let resolvePromise: (value: Response) => void;
      const pendingResponse = new Promise<Response>((resolve) => {
        resolvePromise = resolve;
      });
      mockFetch.mockReturnValue(pendingResponse);

      // Start two concurrent requests
      const promise1 = apiGet('/api/same');
      const promise2 = apiGet('/api/same');

      // Resolve the fetch
      resolvePromise!({
        ok: true,
        json: () => Promise.resolve({ data: 'shared' }),
      } as Response);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Should only make one fetch call
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result1).toEqual({ data: 'shared' });
      expect(result2).toEqual({ data: 'shared' });
    });

    it('should not deduplicate POST requests', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: Math.random() }),
      });

      const promise1 = apiPost('/api/create', { name: 'a' });
      const promise2 = apiPost('/api/create', { name: 'a' });

      await Promise.all([promise1, promise2]);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should not deduplicate different URLs', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const promise1 = apiGet('/api/one');
      const promise2 = apiGet('/api/two');

      await Promise.all([promise1, promise2]);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ===========================================================================
  // Timeout Tests
  // ===========================================================================

  describe('timeout handling', () => {
    it('should pass abort signal to fetch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: 'test' }),
      });

      await apiGet('/api/test', { timeout: 5000 });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });
  });

  // ===========================================================================
  // Headers Tests
  // ===========================================================================

  describe('headers', () => {
    it('should include Content-Type by default', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await apiGet('/api/test');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should allow custom headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await apiGet('/api/test', {
        headers: { Authorization: 'Bearer token' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer token',
          }),
        })
      );
    });
  });
});

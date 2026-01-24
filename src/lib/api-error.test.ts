/**
 * Tests for API error handler.
 *
 * Covers status code mapping and token invalidation logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleApiError } from './api-error';

// Mock dependencies
vi.mock('@/lib/github/client', () => ({
  invalidateTokenCache: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Import mocked functions for assertions
import { invalidateTokenCache } from '@/lib/github/client';
import { logger } from '@/lib/logger';

describe('handleApiError', () => {
  const startTime = 1000;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock Date.now() for consistent timing
    vi.spyOn(Date, 'now').mockReturnValue(1500);
  });

  describe('status code mapping', () => {
    it.each([
      { message: 'Resource not found', expectedStatus: 404 },
      { message: 'Not found in database', expectedStatus: 404 },
      { message: 'Access forbidden', expectedStatus: 403 },
      { message: 'Permission denied', expectedStatus: 403 },
      { message: 'Access denied to resource', expectedStatus: 403 },
      { message: 'Unauthorized access', expectedStatus: 401 },
      { message: 'Authentication required', expectedStatus: 401 },
      { message: 'Bad credentials provided', expectedStatus: 401 },
      { message: 'Validation failed', expectedStatus: 400 },
      { message: 'Field required', expectedStatus: 400 },
      { message: 'Invalid input data', expectedStatus: 400 },
      { message: 'Resource already exists', expectedStatus: 409 },
      { message: 'Conflict detected', expectedStatus: 409 },
      { message: 'Request timeout', expectedStatus: 429 },
      { message: 'Rate limit exceeded', expectedStatus: 429 },
    ])(
      'should map "$message" to status $expectedStatus',
      async ({ message, expectedStatus }) => {
        const error = new Error(message);
        const response = handleApiError(error, 'TEST', startTime);

        expect(response.status).toBe(expectedStatus);
      }
    );

    it('should default to 500 for unknown errors', async () => {
      const error = new Error('Something unexpected happened');
      const response = handleApiError(error, 'TEST', startTime);

      expect(response.status).toBe(500);
    });

    it('should use error.status if present and no pattern match', async () => {
      const error = Object.assign(new Error('Custom error'), { status: 422 });
      const response = handleApiError(error, 'TEST', startTime);

      expect(response.status).toBe(422);
    });

    it('should allow explicit status override', async () => {
      const error = new Error('Not found');
      const response = handleApiError(error, 'TEST', startTime, {
        statusCode: 503,
      });

      expect(response.status).toBe(503);
    });
  });

  describe('response body', () => {
    it('should include error message', async () => {
      const error = new Error('Test error message');
      const response = handleApiError(error, 'TEST', startTime);
      const body = await response.json();

      expect(body.success).toBe(false);
      expect(body.error).toBe('Test error message');
    });

    it('should include timing metadata', async () => {
      const error = new Error('Test');
      const response = handleApiError(error, 'TEST', startTime);
      const body = await response.json();

      expect(body.meta.totalTimeMs).toBe(500); // 1500 - 1000
    });

    it('should allow custom response message', async () => {
      const error = new Error('Internal details');
      const response = handleApiError(error, 'TEST', startTime, {
        responseMessage: 'User-friendly message',
      });
      const body = await response.json();

      expect(body.error).toBe('User-friendly message');
    });

    it('should handle non-Error objects', async () => {
      const error = 'String error';
      const response = handleApiError(error, 'TEST', startTime);
      const body = await response.json();

      expect(body.error).toBe('Unknown error');
    });
  });

  describe('token invalidation', () => {
    it.each([
      { message: 'Unauthorized', status: 401 },
      { message: 'Access forbidden', status: 403 },
      { message: 'Authentication failed', status: 401 },
      { message: 'Bad credentials', status: 401 },
    ])(
      'should invalidate token for "$message"',
      ({ message }) => {
        const error = new Error(message);
        handleApiError(error, 'TEST', startTime);

        expect(invalidateTokenCache).toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Invalidating token cache'),
          'TEST'
        );
      }
    );

    it('should invalidate token when error.status is 401', () => {
      const error = Object.assign(new Error('Custom'), { status: 401 });
      handleApiError(error, 'TEST', startTime);

      expect(invalidateTokenCache).toHaveBeenCalled();
    });

    it('should invalidate token when error.status is 403', () => {
      const error = Object.assign(new Error('Custom'), { status: 403 });
      handleApiError(error, 'TEST', startTime);

      expect(invalidateTokenCache).toHaveBeenCalled();
    });

    it('should not invalidate token for other errors', () => {
      const error = new Error('Something went wrong');
      handleApiError(error, 'TEST', startTime);

      expect(invalidateTokenCache).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('should log error with context', () => {
      const error = new Error('Test error');
      handleApiError(error, 'GET /api/test', startTime);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error after'),
        'Test error',
        'GET /api/test'
      );
    });

    it('should include timing in log', () => {
      const error = new Error('Test');
      handleApiError(error, 'TEST', startTime);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('500ms'),
        expect.any(String),
        expect.any(String)
      );
    });
  });
});

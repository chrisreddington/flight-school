/**
 * Tests for API request-body parsing utilities.
 */

import { describe, it, expect, vi } from 'vitest';
import { parseJsonBody, parseJsonBodyWithFallback } from './request-utils';
import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRequest(jsonValue?: unknown, shouldThrow = false): NextRequest {
  return {
    json: shouldThrow
      ? vi.fn().mockRejectedValue(new Error('Unexpected token'))
      : vi.fn().mockResolvedValue(jsonValue),
  } as unknown as NextRequest;
}

// ---------------------------------------------------------------------------
// parseJsonBody
// ---------------------------------------------------------------------------

describe('parseJsonBody', () => {
  it('should return success result with parsed object', async () => {
    const req = mockRequest({ message: 'hello' });
    const result = await parseJsonBody<{ message: string }>(req);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ message: 'hello' });
    }
  });

  it('should return success result with parsed array', async () => {
    const req = mockRequest([1, 2, 3]);
    const result = await parseJsonBody<number[]>(req);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([1, 2, 3]);
    }
  });

  it('should return success result with null body', async () => {
    const req = mockRequest(null);
    const result = await parseJsonBody(req);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it('should return failure result when JSON parsing throws', async () => {
    const req = mockRequest(undefined, true);
    const result = await parseJsonBody(req);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Unexpected token');
    }
  });

  it('should return generic error message for non-Error throws', async () => {
    const req = {
      json: vi.fn().mockRejectedValue('string error'),
    } as unknown as NextRequest;

    const result = await parseJsonBody(req);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Invalid JSON in request body');
    }
  });
});

// ---------------------------------------------------------------------------
// parseJsonBodyWithFallback
// ---------------------------------------------------------------------------

describe('parseJsonBodyWithFallback', () => {
  it('should return parsed object on success', async () => {
    const req = mockRequest({ key: 'value' });
    const result = await parseJsonBodyWithFallback<{ key: string }>(req, { key: 'default' });
    expect(result).toEqual({ key: 'value' });
  });

  it('should return fallback when JSON parsing throws', async () => {
    const req = mockRequest(undefined, true);
    const fallback = { key: 'default' };
    const result = await parseJsonBodyWithFallback<{ key: string }>(req, fallback);
    expect(result).toBe(fallback);
  });

  it('should return empty array fallback on parse failure', async () => {
    const req = mockRequest(undefined, true);
    const result = await parseJsonBodyWithFallback<string[]>(req, []);
    expect(result).toEqual([]);
  });

  it('should return null fallback on parse failure', async () => {
    const req = mockRequest(undefined, true);
    const result = await parseJsonBodyWithFallback<null>(req, null);
    expect(result).toBeNull();
  });

  it('should return parsed nested object', async () => {
    const body = { nested: { count: 42 } };
    const req = mockRequest(body);
    const result = await parseJsonBodyWithFallback(req, {});
    expect(result).toEqual(body);
  });
});

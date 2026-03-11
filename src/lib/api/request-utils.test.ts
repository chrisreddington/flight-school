/**
 * API Request Utilities Tests
 *
 * Tests for parseJsonBody and parseJsonBodyWithFallback.
 * NextRequest is mocked as a minimal object with a json() method.
 */

import { describe, expect, it } from 'vitest';
import { parseJsonBody, parseJsonBodyWithFallback } from './request-utils';
import type { NextRequest } from 'next/server';

// =============================================================================
// Helpers
// =============================================================================

/** Creates a minimal NextRequest-like mock. */
function makeRequest(jsonImpl: () => Promise<unknown>): NextRequest {
  return { json: jsonImpl } as unknown as NextRequest;
}

// =============================================================================
// parseJsonBody
// =============================================================================

describe('parseJsonBody', () => {
  it('should return success:true with data when json() resolves', async () => {
    const payload = { message: 'hello' };
    const req = makeRequest(() => Promise.resolve(payload));

    const result = await parseJsonBody(req);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(payload);
    }
  });

  it('should return success:false with error message when json() throws an Error', async () => {
    const req = makeRequest(() => Promise.reject(new Error('Unexpected token')));

    const result = await parseJsonBody(req);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Unexpected token');
    }
  });

  it('should return generic message when json() throws a non-Error', async () => {
    const req = makeRequest(() => Promise.reject('bad input'));

    const result = await parseJsonBody(req);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Invalid JSON in request body');
    }
  });

  it('should handle arrays as valid JSON', async () => {
    const req = makeRequest(() => Promise.resolve([1, 2, 3]));

    const result = await parseJsonBody<number[]>(req);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([1, 2, 3]);
    }
  });

  it('should handle null as valid JSON', async () => {
    const req = makeRequest(() => Promise.resolve(null));

    const result = await parseJsonBody(req);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });
});

// =============================================================================
// parseJsonBodyWithFallback
// =============================================================================

describe('parseJsonBodyWithFallback', () => {
  it('should return parsed data when json() resolves', async () => {
    const payload = { name: 'Alice' };
    const req = makeRequest(() => Promise.resolve(payload));

    const result = await parseJsonBodyWithFallback(req, {});

    expect(result).toEqual(payload);
  });

  it('should return the fallback when json() throws', async () => {
    const fallback = { name: 'default' };
    const req = makeRequest(() => Promise.reject(new Error('bad JSON')));

    const result = await parseJsonBodyWithFallback(req, fallback);

    expect(result).toEqual(fallback);
  });

  it('should return the fallback for different types (empty array)', async () => {
    const req = makeRequest(() => Promise.reject(new Error('fail')));

    const result = await parseJsonBodyWithFallback<string[]>(req, []);

    expect(result).toEqual([]);
  });

  it('should return the fallback for null fallback value', async () => {
    const req = makeRequest(() => Promise.reject(new Error('fail')));

    const result = await parseJsonBodyWithFallback<null>(req, null);

    expect(result).toBeNull();
  });
});

/**
 * Tests for API request utilities.
 */

import { describe, expect, it } from 'vitest';
import { parseJsonBody, parseJsonBodyWithFallback } from './request-utils';

/** Creates a minimal NextRequest-like object from the given JSON value. */
function makeRequest(jsonValue: unknown, throwOnParse = false): { json: () => Promise<unknown> } {
  return {
    json: throwOnParse
      ? () => Promise.reject(new Error('Unexpected token'))
      : () => Promise.resolve(jsonValue),
  };
}

describe('parseJsonBody', () => {
  it('should return success:true with parsed data for a valid JSON body', async () => {
    const body = { title: 'hello', level: 1 };
    const req = makeRequest(body);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await parseJsonBody(req as any);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(body);
    }
  });

  it('should return success:true with an array body', async () => {
    const body = [1, 2, 3];
    const req = makeRequest(body);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await parseJsonBody(req as any);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(body);
    }
  });

  it('should return success:false with error message when request.json throws', async () => {
    const req = makeRequest(null, /* throwOnParse */ true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await parseJsonBody(req as any);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Unexpected token');
    }
  });

  it('should use fallback error message when the thrown error is not an Error instance', async () => {
    const req = {
      json: () => Promise.reject('plain string error'),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await parseJsonBody(req as any);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Invalid JSON in request body');
    }
  });
});

describe('parseJsonBodyWithFallback', () => {
  it('should return parsed data on success', async () => {
    const body = { name: 'alice' };
    const req = makeRequest(body);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await parseJsonBodyWithFallback(req as any, {});

    expect(result).toEqual(body);
  });

  it('should return the fallback value when request.json throws', async () => {
    const fallback = { default: true };
    const req = makeRequest(null, /* throwOnParse */ true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await parseJsonBodyWithFallback(req as any, fallback);

    expect(result).toEqual(fallback);
  });

  it('should return null fallback when provided and parsing fails', async () => {
    const req = makeRequest(null, /* throwOnParse */ true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await parseJsonBodyWithFallback(req as any, null);

    expect(result).toBeNull();
  });
});

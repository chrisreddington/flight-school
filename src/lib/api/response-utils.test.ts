/**
 * Tests for API response utilities.
 *
 * NextResponse is mocked so we can inspect the arguments passed to
 * NextResponse.json() without needing a real Next.js server context.
 */
import { describe, expect, it, vi } from 'vitest';

// Mock next/server before importing the module under test.
vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      _body: body,
      _status: init?.status ?? 200,
    })),
  },
}));

import { apiSuccess, serviceUnavailableResponse, validationErrorResponse } from './response-utils';

// Helper type so assertions don't need excessive casting.
interface MockResponse {
  _body: Record<string, unknown>;
  _status: number;
}

describe('apiSuccess', () => {
  it('should return success:true with the supplied data', () => {
    const res = apiSuccess({ name: 'test' }) as unknown as MockResponse;
    expect(res._body.success).toBe(true);
    expect(res._body.data).toEqual({ name: 'test' });
  });

  it('should default to HTTP 200', () => {
    const res = apiSuccess('ok') as unknown as MockResponse;
    expect(res._status).toBe(200);
  });

  it('should include meta when provided', () => {
    const res = apiSuccess('value', { timing: 42 }) as unknown as MockResponse;
    expect(res._body.meta).toEqual({ timing: 42 });
  });

  it('should omit the meta key entirely when not provided', () => {
    const res = apiSuccess('value') as unknown as MockResponse;
    expect(res._body).not.toHaveProperty('meta');
  });
});

describe('validationErrorResponse', () => {
  it('should return success:false with the error message', () => {
    const res = validationErrorResponse('title is required') as unknown as MockResponse;
    expect(res._body.success).toBe(false);
    expect(res._body.error).toBe('title is required');
  });

  it('should use HTTP 400', () => {
    const res = validationErrorResponse('bad input') as unknown as MockResponse;
    expect(res._status).toBe(400);
  });

  it('should include meta when provided', () => {
    const res = validationErrorResponse('bad request', { field: 'name' }) as unknown as MockResponse;
    expect(res._body.meta).toEqual({ field: 'name' });
  });

  it('should omit the meta key entirely when not provided', () => {
    const res = validationErrorResponse('bad request') as unknown as MockResponse;
    expect(res._body).not.toHaveProperty('meta');
  });
});

describe('serviceUnavailableResponse', () => {
  it('should return success:false with the error message', () => {
    const res = serviceUnavailableResponse('GitHub not configured') as unknown as MockResponse;
    expect(res._body.success).toBe(false);
    expect(res._body.error).toBe('GitHub not configured');
  });

  it('should use HTTP 503', () => {
    const res = serviceUnavailableResponse('unavailable') as unknown as MockResponse;
    expect(res._status).toBe(503);
  });

  it('should include meta when provided', () => {
    const res = serviceUnavailableResponse('unavailable', { retryAfter: 30 }) as unknown as MockResponse;
    expect(res._body.meta).toEqual({ retryAfter: 30 });
  });

  it('should omit the meta key entirely when not provided', () => {
    const res = serviceUnavailableResponse('unavailable') as unknown as MockResponse;
    expect(res._body).not.toHaveProperty('meta');
  });
});

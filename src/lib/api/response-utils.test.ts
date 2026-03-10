/**
 * Tests for API Response Utilities.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock next/server before importing the module under test
vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      _body: body,
      _status: init?.status ?? 200,
    })),
  },
}));

import { apiSuccess, serviceUnavailableResponse, validationErrorResponse } from './response-utils';
import { NextResponse } from 'next/server';

const mockJsonFn = NextResponse.json as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockJsonFn.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('apiSuccess', () => {
  it('should call NextResponse.json with success:true and data', () => {
    const data = { id: 1, name: 'test' };
    apiSuccess(data);

    expect(mockJsonFn).toHaveBeenCalledOnce();
    const [body] = mockJsonFn.mock.calls[0];
    expect(body).toEqual({ success: true, data });
  });

  it('should use HTTP 200 by default', () => {
    apiSuccess({ ok: true });
    const [, init] = mockJsonFn.mock.calls[0] ?? [];
    expect(init).toBeUndefined(); // NextResponse.json default = 200
  });

  it('should include meta when provided', () => {
    const data = 'hello';
    const meta = { timeMs: 42 };
    apiSuccess(data, meta);

    const [body] = mockJsonFn.mock.calls[0];
    expect(body).toEqual({ success: true, data, meta });
  });

  it('should NOT include meta key when meta is not provided', () => {
    apiSuccess({ x: 1 });

    const [body] = mockJsonFn.mock.calls[0];
    expect(Object.keys(body as object)).not.toContain('meta');
  });
});

describe('validationErrorResponse', () => {
  it('should call NextResponse.json with success:false and error message', () => {
    validationErrorResponse('Field is required');

    const [body] = mockJsonFn.mock.calls[0];
    expect(body).toMatchObject({ success: false, error: 'Field is required' });
  });

  it('should use HTTP 400 status', () => {
    validationErrorResponse('bad request');

    const [, init] = mockJsonFn.mock.calls[0];
    expect((init as { status: number }).status).toBe(400);
  });

  it('should include meta when provided', () => {
    validationErrorResponse('oops', { field: 'email' });

    const [body] = mockJsonFn.mock.calls[0];
    expect(body).toMatchObject({ success: false, meta: { field: 'email' } });
  });

  it('should NOT include meta key when meta is not provided', () => {
    validationErrorResponse('error');

    const [body] = mockJsonFn.mock.calls[0];
    expect(Object.keys(body as object)).not.toContain('meta');
  });
});

describe('serviceUnavailableResponse', () => {
  it('should call NextResponse.json with success:false and error message', () => {
    serviceUnavailableResponse('Service down');

    const [body] = mockJsonFn.mock.calls[0];
    expect(body).toMatchObject({ success: false, error: 'Service down' });
  });

  it('should use HTTP 503 status', () => {
    serviceUnavailableResponse('unavailable');

    const [, init] = mockJsonFn.mock.calls[0];
    expect((init as { status: number }).status).toBe(503);
  });

  it('should include meta when provided', () => {
    serviceUnavailableResponse('down', { retryAfter: 30 });

    const [body] = mockJsonFn.mock.calls[0];
    expect(body).toMatchObject({ success: false, meta: { retryAfter: 30 } });
  });
});

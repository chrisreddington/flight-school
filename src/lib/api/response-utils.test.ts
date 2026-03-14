/**
 * Tests for API response utilities.
 *
 * Verifies response shape, HTTP status codes, and optional metadata.
 * NextResponse.json is mocked so tests run without a Next.js runtime.
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

import { apiSuccess, validationErrorResponse, serviceUnavailableResponse } from './response-utils';
import { NextResponse } from 'next/server';

const mockNextResponseJson = NextResponse.json as ReturnType<typeof vi.fn>;

describe('apiSuccess', () => {
  beforeEach(() => {
    mockNextResponseJson.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call NextResponse.json with success: true and the provided data', () => {
    const data = { id: 1, name: 'test' };
    apiSuccess(data);

    expect(mockNextResponseJson).toHaveBeenCalledOnce();
    const [body, init] = mockNextResponseJson.mock.calls[0];
    expect(body.success).toBe(true);
    expect(body.data).toEqual(data);
    expect(init).toBeUndefined();
  });

  it('should include meta when provided', () => {
    const meta = { totalTimeMs: 42 };
    apiSuccess({ result: 'ok' }, meta);

    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body.meta).toEqual(meta);
  });

  it('should NOT include meta key when meta is undefined', () => {
    apiSuccess({ result: 'ok' });

    const [body] = mockNextResponseJson.mock.calls[0];
    expect(Object.prototype.hasOwnProperty.call(body, 'meta')).toBe(false);
  });

  it('should work with primitive data values', () => {
    apiSuccess('just a string');
    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body.data).toBe('just a string');
  });

  it('should work with array data', () => {
    apiSuccess([1, 2, 3]);
    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body.data).toEqual([1, 2, 3]);
  });
});

describe('validationErrorResponse', () => {
  beforeEach(() => {
    mockNextResponseJson.mockClear();
  });

  it('should call NextResponse.json with success: false and status 400', () => {
    validationErrorResponse('Field is required');

    expect(mockNextResponseJson).toHaveBeenCalledOnce();
    const [body, init] = mockNextResponseJson.mock.calls[0];
    expect(body.success).toBe(false);
    expect(body.error).toBe('Field is required');
    expect(init?.status).toBe(400);
  });

  it('should include meta when provided', () => {
    const meta = { field: 'email' };
    validationErrorResponse('Invalid email', meta);

    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body.meta).toEqual(meta);
  });

  it('should NOT include meta key when meta is omitted', () => {
    validationErrorResponse('Missing field');

    const [body] = mockNextResponseJson.mock.calls[0];
    expect(Object.prototype.hasOwnProperty.call(body, 'meta')).toBe(false);
  });
});

describe('serviceUnavailableResponse', () => {
  beforeEach(() => {
    mockNextResponseJson.mockClear();
  });

  it('should call NextResponse.json with success: false and status 503', () => {
    serviceUnavailableResponse('GitHub API not configured');

    expect(mockNextResponseJson).toHaveBeenCalledOnce();
    const [body, init] = mockNextResponseJson.mock.calls[0];
    expect(body.success).toBe(false);
    expect(body.error).toBe('GitHub API not configured');
    expect(init?.status).toBe(503);
  });

  it('should include meta when provided', () => {
    const meta = { reason: 'token missing' };
    serviceUnavailableResponse('Unavailable', meta);

    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body.meta).toEqual(meta);
  });

  it('should NOT include meta key when meta is omitted', () => {
    serviceUnavailableResponse('Service down');

    const [body] = mockNextResponseJson.mock.calls[0];
    expect(Object.prototype.hasOwnProperty.call(body, 'meta')).toBe(false);
  });
});

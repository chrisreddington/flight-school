/**
 * Tests for API response utilities.
 *
 * Covers all response builders: apiSuccess, validationErrorResponse, serviceUnavailableResponse.
 * Uses vi.mock to isolate from Next.js runtime.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock NextResponse before importing response-utils
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

const mockNextResponseJson = vi.mocked(NextResponse.json);

describe('apiSuccess', () => {
  beforeEach(() => {
    mockNextResponseJson.mockClear();
  });

  it('should return a success response with data', () => {
    const data = { id: 1, name: 'test' };
    apiSuccess(data);

    expect(mockNextResponseJson).toHaveBeenCalledOnce();
    const [body, init] = mockNextResponseJson.mock.calls[0];
    expect(body).toEqual({ success: true, data });
    expect(init).toBeUndefined();
  });

  it('should include meta when provided', () => {
    const data = { value: 42 };
    const meta = { totalTimeMs: 123, aiEnabled: true };
    apiSuccess(data, meta);

    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body).toEqual({ success: true, data, meta });
  });

  it('should not include meta key when meta is not provided', () => {
    apiSuccess({ value: 'test' });

    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body).not.toHaveProperty('meta');
  });

  it('should handle array data', () => {
    const data = [1, 2, 3];
    apiSuccess(data);

    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body).toEqual({ success: true, data });
  });

  it('should handle null data', () => {
    apiSuccess(null);

    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body).toEqual({ success: true, data: null });
  });
});

describe('validationErrorResponse', () => {
  beforeEach(() => {
    mockNextResponseJson.mockClear();
  });

  it('should return a 400 error response with the given message', () => {
    validationErrorResponse('title is required');

    expect(mockNextResponseJson).toHaveBeenCalledOnce();
    const [body, init] = mockNextResponseJson.mock.calls[0];
    expect(body).toEqual({ success: false, error: 'title is required' });
    expect(init).toEqual({ status: 400 });
  });

  it('should include meta when provided', () => {
    const meta = { totalTimeMs: 5 };
    validationErrorResponse('field is required', meta);

    const [body, init] = mockNextResponseJson.mock.calls[0];
    expect(body).toEqual({ success: false, error: 'field is required', meta });
    expect(init).toEqual({ status: 400 });
  });

  it('should not include meta key when meta is not provided', () => {
    validationErrorResponse('some error');

    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body).not.toHaveProperty('meta');
  });
});

describe('serviceUnavailableResponse', () => {
  beforeEach(() => {
    mockNextResponseJson.mockClear();
  });

  it('should return a 503 error response with the given message', () => {
    serviceUnavailableResponse('GitHub API not configured');

    expect(mockNextResponseJson).toHaveBeenCalledOnce();
    const [body, init] = mockNextResponseJson.mock.calls[0];
    expect(body).toEqual({ success: false, error: 'GitHub API not configured' });
    expect(init).toEqual({ status: 503 });
  });

  it('should include meta when provided', () => {
    const meta = { totalTimeMs: 10 };
    serviceUnavailableResponse('Service unavailable', meta);

    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body).toEqual({ success: false, error: 'Service unavailable', meta });
  });

  it('should not include meta key when meta is not provided', () => {
    serviceUnavailableResponse('error message');

    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body).not.toHaveProperty('meta');
  });
});

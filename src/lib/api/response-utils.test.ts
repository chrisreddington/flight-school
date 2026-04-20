/**
 * Tests for API response utilities.
 *
 * Covers apiSuccess, validationErrorResponse, and serviceUnavailableResponse.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted — use vi.hoisted() to declare the mock before it is called
const { mockNextResponseJson } = vi.hoisted(() => {
  const mockNextResponseJson = vi.fn((body: unknown, init?: { status?: number }) => ({
    _body: body,
    _status: init?.status ?? 200,
  }));
  return { mockNextResponseJson };
});

vi.mock('next/server', () => ({
  NextResponse: {
    json: mockNextResponseJson,
  },
}));

import { apiSuccess, serviceUnavailableResponse, validationErrorResponse } from './response-utils';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('apiSuccess', () => {
  it('should call NextResponse.json with success: true and the data', () => {
    apiSuccess({ id: 1 });
    expect(mockNextResponseJson).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: { id: 1 } })
    );
  });

  it('should not include meta when not provided', () => {
    apiSuccess('result');
    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body).not.toHaveProperty('meta');
  });

  it('should include meta when provided', () => {
    apiSuccess('result', { totalTimeMs: 42 });
    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body).toHaveProperty('meta', { totalTimeMs: 42 });
  });

  it('should use the default status 200', () => {
    const response = apiSuccess('ok');
    expect((response as unknown as { _status: number })._status).toBe(200);
  });

  it('should accept null as data', () => {
    apiSuccess(null);
    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body.data).toBeNull();
  });
});

describe('validationErrorResponse', () => {
  it('should call NextResponse.json with success: false', () => {
    validationErrorResponse('field is required');
    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body.success).toBe(false);
  });

  it('should include the error message', () => {
    validationErrorResponse('name is required');
    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body.error).toBe('name is required');
  });

  it('should use status 400', () => {
    const response = validationErrorResponse('bad input');
    expect((response as unknown as { _status: number })._status).toBe(400);
  });

  it('should not include meta when not provided', () => {
    validationErrorResponse('bad input');
    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body).not.toHaveProperty('meta');
  });

  it('should include meta when provided', () => {
    validationErrorResponse('bad input', { totalTimeMs: 10 });
    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body.meta).toEqual({ totalTimeMs: 10 });
  });
});

describe('serviceUnavailableResponse', () => {
  it('should call NextResponse.json with success: false', () => {
    serviceUnavailableResponse('service down');
    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body.success).toBe(false);
  });

  it('should include the error message', () => {
    serviceUnavailableResponse('GitHub not configured');
    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body.error).toBe('GitHub not configured');
  });

  it('should use status 503', () => {
    const response = serviceUnavailableResponse('unavailable');
    expect((response as unknown as { _status: number })._status).toBe(503);
  });

  it('should not include meta when not provided', () => {
    serviceUnavailableResponse('unavailable');
    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body).not.toHaveProperty('meta');
  });

  it('should include meta when provided', () => {
    serviceUnavailableResponse('unavailable', { reason: 'no token' });
    const [body] = mockNextResponseJson.mock.calls[0];
    expect(body.meta).toEqual({ reason: 'no token' });
  });
});

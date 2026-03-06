/**
 * Tests for API response utilities.
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

const mockJson = vi.mocked(NextResponse.json);

beforeEach(() => {
  mockJson.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('apiSuccess', () => {
  it('should call NextResponse.json with success:true and the data', () => {
    const data = { name: 'test' };
    apiSuccess(data);

    expect(mockJson).toHaveBeenCalledOnce();
    const [body, init] = mockJson.mock.calls[0];
    expect(body).toMatchObject({ success: true, data });
    expect(init).toBeUndefined();
  });

  it('should include meta when provided', () => {
    const meta = { totalTimeMs: 42 };
    apiSuccess({ result: 1 }, meta);

    const [body] = mockJson.mock.calls[0];
    expect(body).toMatchObject({ success: true, meta });
  });

  it('should not include meta key when not provided', () => {
    apiSuccess({ result: 1 });

    const [body] = mockJson.mock.calls[0];
    expect(body).not.toHaveProperty('meta');
  });

  it('should work with primitive data values', () => {
    apiSuccess(42);

    const [body] = mockJson.mock.calls[0];
    expect((body as { data: unknown }).data).toBe(42);
  });

  it('should work with null data', () => {
    apiSuccess(null);

    const [body] = mockJson.mock.calls[0];
    expect((body as { data: unknown }).data).toBeNull();
  });
});

describe('validationErrorResponse', () => {
  it('should call NextResponse.json with success:false and status 400', () => {
    validationErrorResponse('title is required');

    expect(mockJson).toHaveBeenCalledOnce();
    const [body, init] = mockJson.mock.calls[0];
    expect(body).toMatchObject({ success: false, error: 'title is required' });
    expect((init as { status?: number })?.status).toBe(400);
  });

  it('should include meta when provided', () => {
    validationErrorResponse('bad input', { field: 'name' });

    const [body] = mockJson.mock.calls[0];
    expect(body).toMatchObject({ meta: { field: 'name' } });
  });

  it('should not include meta key when not provided', () => {
    validationErrorResponse('bad input');

    const [body] = mockJson.mock.calls[0];
    expect(body).not.toHaveProperty('meta');
  });
});

describe('serviceUnavailableResponse', () => {
  it('should call NextResponse.json with success:false and status 503', () => {
    serviceUnavailableResponse('Service is down');

    expect(mockJson).toHaveBeenCalledOnce();
    const [body, init] = mockJson.mock.calls[0];
    expect(body).toMatchObject({ success: false, error: 'Service is down' });
    expect((init as { status?: number })?.status).toBe(503);
  });

  it('should include meta when provided', () => {
    serviceUnavailableResponse('unavailable', { aiEnabled: false });

    const [body] = mockJson.mock.calls[0];
    expect(body).toMatchObject({ meta: { aiEnabled: false } });
  });

  it('should not include meta key when not provided', () => {
    serviceUnavailableResponse('unavailable');

    const [body] = mockJson.mock.calls[0];
    expect(body).not.toHaveProperty('meta');
  });
});

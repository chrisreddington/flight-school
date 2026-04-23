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

import { NextResponse } from 'next/server';
import { apiSuccess, serviceUnavailableResponse, validationErrorResponse } from './response-utils';

type MockResponse = { _body: Record<string, unknown>; _status: number };

describe('apiSuccess', () => {
  beforeEach(() => {
    vi.mocked(NextResponse.json).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns success:true and the provided data', () => {
    const response = apiSuccess({ id: 1 }) as unknown as MockResponse;
    expect(response._body).toMatchObject({ success: true, data: { id: 1 } });
  });

  it('defaults to HTTP 200', () => {
    const response = apiSuccess('ok') as unknown as MockResponse;
    expect(response._status).toBe(200);
  });

  it('includes meta when provided', () => {
    const meta = { totalTimeMs: 42 };
    const response = apiSuccess('data', meta) as unknown as MockResponse;
    expect(response._body).toMatchObject({ meta });
  });

  it('omits meta key when not provided', () => {
    const response = apiSuccess('data') as unknown as MockResponse;
    expect(response._body).not.toHaveProperty('meta');
  });
});

describe('validationErrorResponse', () => {
  beforeEach(() => {
    vi.mocked(NextResponse.json).mockClear();
  });

  it('returns success:false with the error message', () => {
    const response = validationErrorResponse('title is required') as unknown as MockResponse;
    expect(response._body).toMatchObject({ success: false, error: 'title is required' });
  });

  it('uses HTTP status 400', () => {
    const response = validationErrorResponse('bad input') as unknown as MockResponse;
    expect(response._status).toBe(400);
  });

  it('includes meta when provided', () => {
    const meta = { field: 'title' };
    const response = validationErrorResponse('required', meta) as unknown as MockResponse;
    expect(response._body).toMatchObject({ meta });
  });

  it('omits meta key when not provided', () => {
    const response = validationErrorResponse('required') as unknown as MockResponse;
    expect(response._body).not.toHaveProperty('meta');
  });
});

describe('serviceUnavailableResponse', () => {
  beforeEach(() => {
    vi.mocked(NextResponse.json).mockClear();
  });

  it('returns success:false with the error message', () => {
    const response = serviceUnavailableResponse('GitHub not configured') as unknown as MockResponse;
    expect(response._body).toMatchObject({ success: false, error: 'GitHub not configured' });
  });

  it('uses HTTP status 503', () => {
    const response = serviceUnavailableResponse('unavailable') as unknown as MockResponse;
    expect(response._status).toBe(503);
  });

  it('includes meta when provided', () => {
    const meta = { service: 'github' };
    const response = serviceUnavailableResponse('unavailable', meta) as unknown as MockResponse;
    expect(response._body).toMatchObject({ meta });
  });
});

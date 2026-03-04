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

describe('apiSuccess', () => {
  beforeEach(() => {
    vi.mocked(NextResponse.json).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call NextResponse.json with success: true and the provided data', () => {
    apiSuccess({ id: 1, name: 'test' });

    expect(NextResponse.json).toHaveBeenCalledWith({
      success: true,
      data: { id: 1, name: 'test' },
    });
  });

  it('should include meta when provided', () => {
    apiSuccess({ result: 'ok' }, { totalTimeMs: 42 });

    expect(NextResponse.json).toHaveBeenCalledWith({
      success: true,
      data: { result: 'ok' },
      meta: { totalTimeMs: 42 },
    });
  });

  it('should omit meta key when meta is not provided', () => {
    apiSuccess({ value: 'data' });

    const [body] = vi.mocked(NextResponse.json).mock.calls[0] as [Record<string, unknown>];
    expect(body).not.toHaveProperty('meta');
  });

  it('should accept null as data', () => {
    apiSuccess(null);

    expect(NextResponse.json).toHaveBeenCalledWith({
      success: true,
      data: null,
    });
  });

  it('should accept an array as data', () => {
    apiSuccess([1, 2, 3]);

    expect(NextResponse.json).toHaveBeenCalledWith({
      success: true,
      data: [1, 2, 3],
    });
  });
});

describe('validationErrorResponse', () => {
  beforeEach(() => {
    vi.mocked(NextResponse.json).mockClear();
  });

  it('should call NextResponse.json with success: false, the message, and status 400', () => {
    validationErrorResponse('title is required');

    expect(NextResponse.json).toHaveBeenCalledWith(
      { success: false, error: 'title is required' },
      { status: 400 }
    );
  });

  it('should include meta when provided', () => {
    validationErrorResponse('Field missing', { requestId: 'abc' });

    expect(NextResponse.json).toHaveBeenCalledWith(
      { success: false, error: 'Field missing', meta: { requestId: 'abc' } },
      { status: 400 }
    );
  });

  it('should omit meta key when meta is not provided', () => {
    validationErrorResponse('bad input');

    const [body] = vi.mocked(NextResponse.json).mock.calls[0] as [Record<string, unknown>];
    expect(body).not.toHaveProperty('meta');
  });
});

describe('serviceUnavailableResponse', () => {
  beforeEach(() => {
    vi.mocked(NextResponse.json).mockClear();
  });

  it('should call NextResponse.json with success: false and status 503', () => {
    serviceUnavailableResponse('GitHub API not configured');

    expect(NextResponse.json).toHaveBeenCalledWith(
      { success: false, error: 'GitHub API not configured' },
      { status: 503 }
    );
  });

  it('should include meta when provided', () => {
    serviceUnavailableResponse('Service down', { aiEnabled: false });

    expect(NextResponse.json).toHaveBeenCalledWith(
      { success: false, error: 'Service down', meta: { aiEnabled: false } },
      { status: 503 }
    );
  });

  it('should omit meta key when meta is not provided', () => {
    serviceUnavailableResponse('unavailable');

    const [body] = vi.mocked(NextResponse.json).mock.calls[0] as [Record<string, unknown>];
    expect(body).not.toHaveProperty('meta');
  });
});

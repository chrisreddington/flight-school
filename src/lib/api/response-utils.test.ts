/**
 * Tests for API response utilities.
 *
 * Covers all response builders: apiSuccess, validationErrorResponse,
 * serviceUnavailableResponse.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock next/server before importing response-utils
vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => data,
      _body: data,
    })),
  },
}));

import { apiSuccess, validationErrorResponse, serviceUnavailableResponse } from './response-utils';
import { NextResponse } from 'next/server';

const mockNextResponseJson = vi.mocked(NextResponse.json);

describe('apiSuccess', () => {
  beforeAll(() => {
    mockNextResponseJson.mockImplementation((data, init) => ({
      status: (init as { status?: number } | undefined)?.status ?? 200,
      json: async () => data,
      _body: data,
    } as ReturnType<typeof NextResponse.json>));
  });

  it('should create a success response with data', async () => {
    const data = { id: '123', name: 'Test' };
    apiSuccess(data);

    expect(mockNextResponseJson).toHaveBeenCalledWith({
      success: true,
      data,
    });
  });

  it('should include meta when provided', async () => {
    const data = { value: 42 };
    const meta = { totalTimeMs: 150 };
    apiSuccess(data, meta);

    expect(mockNextResponseJson).toHaveBeenCalledWith({
      success: true,
      data,
      meta,
    });
  });

  it('should not include meta key when meta is undefined', () => {
    apiSuccess({ result: 'ok' });
    const call = mockNextResponseJson.mock.calls[0];
    const body = call[0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('meta');
  });

  it('should accept various data types', () => {
    apiSuccess('string data');
    expect(mockNextResponseJson).toHaveBeenCalledWith({
      success: true,
      data: 'string data',
    });

    apiSuccess([1, 2, 3]);
    expect(mockNextResponseJson).toHaveBeenCalledWith({
      success: true,
      data: [1, 2, 3],
    });

    apiSuccess(null);
    expect(mockNextResponseJson).toHaveBeenCalledWith({
      success: true,
      data: null,
    });
  });
});

describe('validationErrorResponse', () => {
  it('should create a 400 error response', () => {
    validationErrorResponse('Title is required');

    expect(mockNextResponseJson).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'Title is required' }),
      { status: 400 }
    );
  });

  it('should include meta when provided', () => {
    const meta = { field: 'title' };
    validationErrorResponse('Title is required', meta);

    expect(mockNextResponseJson).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'Title is required', meta }),
      { status: 400 }
    );
  });

  it('should not include meta key when meta is undefined', () => {
    validationErrorResponse('Some error');
    const call = mockNextResponseJson.mock.calls[0];
    const body = call[0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('meta');
  });

  it('should use status 400', () => {
    validationErrorResponse('Bad input');
    const call = mockNextResponseJson.mock.calls[0];
    expect(call[1]).toEqual({ status: 400 });
  });
});

describe('serviceUnavailableResponse', () => {
  it('should create a 503 error response', () => {
    serviceUnavailableResponse('Service not configured');

    expect(mockNextResponseJson).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'Service not configured' }),
      { status: 503 }
    );
  });

  it('should include meta when provided', () => {
    const meta = { aiEnabled: false };
    serviceUnavailableResponse('AI not available', meta);

    expect(mockNextResponseJson).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'AI not available',
        meta,
      }),
      { status: 503 }
    );
  });

  it('should use status 503', () => {
    serviceUnavailableResponse('Unavailable');
    const call = mockNextResponseJson.mock.calls[0];
    expect(call[1]).toEqual({ status: 503 });
  });
});

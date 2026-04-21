/**
 * Tests for API response utilities.
 *
 * Covers apiSuccess, validationErrorResponse, and serviceUnavailableResponse
 * response shape and HTTP status codes.
 */

import { describe, it, expect } from 'vitest';
import { apiSuccess, validationErrorResponse, serviceUnavailableResponse } from './response-utils';

describe('apiSuccess', () => {
  it('should return success:true with the provided data', async () => {
    const response = apiSuccess({ id: 1, name: 'Test' });
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(body.data).toEqual({ id: 1, name: 'Test' });
  });

  it('should default to HTTP 200 status', () => {
    const response = apiSuccess({});
    expect(response.status).toBe(200);
  });

  it('should include meta when provided', async () => {
    const meta = { totalTimeMs: 42, aiEnabled: true };
    const response = apiSuccess({ result: 'ok' }, meta);
    const body = await response.json();

    expect(body.meta).toEqual(meta);
  });

  it('should omit meta key when meta is not provided', async () => {
    const response = apiSuccess({ result: 'ok' });
    const body = await response.json();

    expect(body).not.toHaveProperty('meta');
  });

  it('should handle array data', async () => {
    const data = [1, 2, 3];
    const response = apiSuccess(data);
    const body = await response.json();

    expect(body.data).toEqual([1, 2, 3]);
  });

  it('should handle null data', async () => {
    const response = apiSuccess(null);
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
  });
});

describe('validationErrorResponse', () => {
  it('should return success:false with the error message', async () => {
    const response = validationErrorResponse('name is required');
    const body = await response.json();

    expect(body.success).toBe(false);
    expect(body.error).toBe('name is required');
  });

  it('should return HTTP 400 status', () => {
    const response = validationErrorResponse('invalid input');
    expect(response.status).toBe(400);
  });

  it('should include meta when provided', async () => {
    const meta = { field: 'email' };
    const response = validationErrorResponse('email is required', meta);
    const body = await response.json();

    expect(body.meta).toEqual(meta);
  });

  it('should omit meta key when meta is not provided', async () => {
    const response = validationErrorResponse('bad request');
    const body = await response.json();

    expect(body).not.toHaveProperty('meta');
  });
});

describe('serviceUnavailableResponse', () => {
  it('should return success:false with the error message', async () => {
    const response = serviceUnavailableResponse('GitHub API not configured');
    const body = await response.json();

    expect(body.success).toBe(false);
    expect(body.error).toBe('GitHub API not configured');
  });

  it('should return HTTP 503 status', () => {
    const response = serviceUnavailableResponse('service down');
    expect(response.status).toBe(503);
  });

  it('should include meta when provided', async () => {
    const meta = { retryAfter: 60 };
    const response = serviceUnavailableResponse('unavailable', meta);
    const body = await response.json();

    expect(body.meta).toEqual(meta);
  });

  it('should omit meta key when meta is not provided', async () => {
    const response = serviceUnavailableResponse('unavailable');
    const body = await response.json();

    expect(body).not.toHaveProperty('meta');
  });
});

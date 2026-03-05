/**
 * Tests for API response utilities.
 *
 * Covers apiSuccess, validationErrorResponse, and serviceUnavailableResponse builders.
 */

import { describe, it, expect } from 'vitest';
import { apiSuccess, validationErrorResponse, serviceUnavailableResponse } from './response-utils';

describe('apiSuccess', () => {
  it('should return a 200 response with success:true and the provided data', async () => {
    const response = apiSuccess({ id: 1, name: 'test' });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ id: 1, name: 'test' });
  });

  it('should not include meta when not provided', async () => {
    const response = apiSuccess('hello');
    const body = await response.json();
    expect(body).not.toHaveProperty('meta');
  });

  it('should include meta when provided', async () => {
    const meta = { totalTimeMs: 42, aiEnabled: true };
    const response = apiSuccess({ result: 'ok' }, meta);
    const body = await response.json();
    expect(body.meta).toEqual(meta);
  });

  it('should handle null data', async () => {
    const response = apiSuccess(null);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
  });

  it('should handle array data', async () => {
    const response = apiSuccess([1, 2, 3]);
    const body = await response.json();
    expect(body.data).toEqual([1, 2, 3]);
  });
});

describe('validationErrorResponse', () => {
  it('should return a 400 response with success:false', async () => {
    const response = validationErrorResponse('title is required');

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('title is required');
  });

  it('should not include meta when not provided', async () => {
    const response = validationErrorResponse('bad input');
    const body = await response.json();
    expect(body).not.toHaveProperty('meta');
  });

  it('should include meta when provided', async () => {
    const meta = { totalTimeMs: 5 };
    const response = validationErrorResponse('bad input', meta);
    const body = await response.json();
    expect(body.meta).toEqual(meta);
  });
});

describe('serviceUnavailableResponse', () => {
  it('should return a 503 response with success:false', async () => {
    const response = serviceUnavailableResponse('GitHub API not configured');

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('GitHub API not configured');
  });

  it('should not include meta when not provided', async () => {
    const response = serviceUnavailableResponse('service down');
    const body = await response.json();
    expect(body).not.toHaveProperty('meta');
  });

  it('should include meta when provided', async () => {
    const meta = { totalTimeMs: 10, service: 'github' };
    const response = serviceUnavailableResponse('service down', meta);
    const body = await response.json();
    expect(body.meta).toEqual(meta);
  });
});

import { describe, expect, it } from 'vitest';
import { apiSuccess, validationErrorResponse, serviceUnavailableResponse } from './response-utils';

describe('apiSuccess', () => {
  it('should return a 200 response with success:true and data', async () => {
    const response = apiSuccess({ id: 1, name: 'test' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ id: 1, name: 'test' });
  });

  it('should include meta when provided', async () => {
    const meta = { aiEnabled: true, durationMs: 42 };
    const response = apiSuccess('result', meta);
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(body.data).toBe('result');
    expect(body.meta).toEqual(meta);
  });

  it('should omit meta key entirely when not provided', async () => {
    const response = apiSuccess([1, 2, 3]);
    const body = await response.json();

    expect(body).not.toHaveProperty('meta');
  });

  it('should handle null data', async () => {
    const response = apiSuccess(null);
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
  });

  it('should handle array data', async () => {
    const data = [{ id: 1 }, { id: 2 }];
    const response = apiSuccess(data);
    const body = await response.json();

    expect(body.data).toEqual(data);
  });
});

describe('validationErrorResponse', () => {
  it('should return a 400 response with success:false and error message', async () => {
    const response = validationErrorResponse('title is required');
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe('title is required');
  });

  it('should include meta when provided', async () => {
    const meta = { field: 'title' };
    const response = validationErrorResponse('title is required', meta);
    const body = await response.json();

    expect(body.meta).toEqual(meta);
  });

  it('should omit meta when not provided', async () => {
    const response = validationErrorResponse('bad request');
    const body = await response.json();

    expect(body).not.toHaveProperty('meta');
  });
});

describe('serviceUnavailableResponse', () => {
  it('should return a 503 response with success:false and error message', async () => {
    const response = serviceUnavailableResponse('GitHub API not configured');
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.error).toBe('GitHub API not configured');
  });

  it('should include meta when provided', async () => {
    const meta = { configured: false };
    const response = serviceUnavailableResponse('Service unavailable', meta);
    const body = await response.json();

    expect(body.meta).toEqual(meta);
  });

  it('should omit meta when not provided', async () => {
    const response = serviceUnavailableResponse('unavailable');
    const body = await response.json();

    expect(body).not.toHaveProperty('meta');
  });
});

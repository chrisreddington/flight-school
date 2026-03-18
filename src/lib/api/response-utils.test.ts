/**
 * Tests for API Response Utilities
 */

import { describe, it, expect } from 'vitest';
import { apiSuccess, validationErrorResponse, serviceUnavailableResponse } from './response-utils';

describe('apiSuccess', () => {
  it('should return a 200 response with success: true and data', async () => {
    const data = { id: 1, name: 'test' };
    const response = apiSuccess(data);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(data);
  });

  it('should include meta when provided', async () => {
    const data = 'hello';
    const meta = { totalTimeMs: 42, aiEnabled: true };
    const response = apiSuccess(data, meta);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toBe('hello');
    expect(body.meta).toEqual(meta);
  });

  it('should omit meta when not provided', async () => {
    const response = apiSuccess({ value: 1 });
    const body = await response.json();

    expect(body).not.toHaveProperty('meta');
  });

  it.each([
    [null, null],
    [[], []],
    [{ nested: { deep: true } }, { nested: { deep: true } }],
    [42, 42],
    ['plain string', 'plain string'],
  ])('should handle various data types: %p', async (data, expected) => {
    const response = apiSuccess(data);
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(body.data).toEqual(expected);
  });
});

describe('validationErrorResponse', () => {
  it('should return a 400 response with success: false', async () => {
    const response = validationErrorResponse('Name is required');

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Name is required');
  });

  it('should include meta when provided', async () => {
    const meta = { totalTimeMs: 10 };
    const response = validationErrorResponse('Invalid input', meta);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Invalid input');
    expect(body.meta).toEqual(meta);
  });

  it('should omit meta when not provided', async () => {
    const response = validationErrorResponse('Error');
    const body = await response.json();

    expect(body).not.toHaveProperty('meta');
  });
});

describe('serviceUnavailableResponse', () => {
  it('should return a 503 response with success: false', async () => {
    const response = serviceUnavailableResponse('GitHub API not configured');

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('GitHub API not configured');
  });

  it('should include meta when provided', async () => {
    const meta = { fallbackReason: 'no-token' };
    const response = serviceUnavailableResponse('Service unavailable', meta);

    const body = await response.json();
    expect(body.meta).toEqual(meta);
  });

  it('should omit meta when not provided', async () => {
    const response = serviceUnavailableResponse('Unavailable');
    const body = await response.json();

    expect(body).not.toHaveProperty('meta');
  });
});

import { describe, it, expect } from 'vitest';
import { apiSuccess, validationErrorResponse, serviceUnavailableResponse } from './response-utils';

describe('apiSuccess', () => {
  it('returns a 200 response by default', () => {
    const response = apiSuccess({ id: 1 });
    expect(response.status).toBe(200);
  });

  it('returns success: true with data', async () => {
    const data = { id: 1, name: 'test' };
    const response = apiSuccess(data);
    const body = await response.json();
    expect(body).toEqual({ success: true, data });
  });

  it('includes meta when provided', async () => {
    const data = { value: 42 };
    const meta = { totalTimeMs: 100 };
    const response = apiSuccess(data, meta);
    const body = await response.json();
    expect(body).toEqual({ success: true, data, meta });
  });

  it('does not include meta key when meta is not provided', async () => {
    const response = apiSuccess({ x: 1 });
    const body = await response.json();
    expect(body).not.toHaveProperty('meta');
  });

  it('handles null data', async () => {
    const response = apiSuccess(null);
    const body = await response.json();
    expect(body).toEqual({ success: true, data: null });
  });

  it('handles array data', async () => {
    const data = [1, 2, 3];
    const response = apiSuccess(data);
    const body = await response.json();
    expect(body).toEqual({ success: true, data });
  });
});

describe('validationErrorResponse', () => {
  it('returns a 400 status', () => {
    const response = validationErrorResponse('title is required');
    expect(response.status).toBe(400);
  });

  it('returns success: false with the error message', async () => {
    const response = validationErrorResponse('title is required');
    const body = await response.json();
    expect(body).toEqual({ success: false, error: 'title is required' });
  });

  it('includes meta when provided', async () => {
    const meta = { totalTimeMs: 50 };
    const response = validationErrorResponse('invalid input', meta);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: 'invalid input', meta });
  });

  it('does not include meta key when meta is not provided', async () => {
    const response = validationErrorResponse('error');
    const body = await response.json();
    expect(body).not.toHaveProperty('meta');
  });
});

describe('serviceUnavailableResponse', () => {
  it('returns a 503 status', () => {
    const response = serviceUnavailableResponse('GitHub API not configured');
    expect(response.status).toBe(503);
  });

  it('returns success: false with the error message', async () => {
    const response = serviceUnavailableResponse('Service unavailable');
    const body = await response.json();
    expect(body).toEqual({ success: false, error: 'Service unavailable' });
  });

  it('includes meta when provided', async () => {
    const meta = { aiEnabled: false, fallbackReason: 'no token' };
    const response = serviceUnavailableResponse('AI not configured', meta);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: 'AI not configured', meta });
  });
});

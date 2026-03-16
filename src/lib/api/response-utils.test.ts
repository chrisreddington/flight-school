import { describe, it, expect } from 'vitest';
import { apiSuccess, validationErrorResponse, serviceUnavailableResponse } from './response-utils';

async function parseResponse(response: Response): Promise<unknown> {
  return response.json();
}

describe('apiSuccess', () => {
  it('returns a response with success: true and the provided data', async () => {
    const response = apiSuccess({ message: 'hello' });
    const body = await parseResponse(response);
    expect(body).toMatchObject({ success: true, data: { message: 'hello' } });
  });

  it('returns HTTP 200 status', () => {
    const response = apiSuccess({ value: 1 });
    expect(response.status).toBe(200);
  });

  it('includes meta when provided', async () => {
    const response = apiSuccess({ value: 1 }, { aiEnabled: true, totalTimeMs: 42 });
    const body = await parseResponse(response);
    expect(body).toMatchObject({ success: true, meta: { aiEnabled: true, totalTimeMs: 42 } });
  });

  it('omits meta when not provided', async () => {
    const response = apiSuccess({ value: 1 });
    const body = await parseResponse(response) as Record<string, unknown>;
    expect(body).not.toHaveProperty('meta');
  });

  it('handles array data', async () => {
    const response = apiSuccess([1, 2, 3]);
    const body = await parseResponse(response);
    expect(body).toMatchObject({ success: true, data: [1, 2, 3] });
  });

  it('handles null data', async () => {
    const response = apiSuccess(null);
    const body = await parseResponse(response);
    expect(body).toMatchObject({ success: true, data: null });
  });
});

describe('validationErrorResponse', () => {
  it('returns HTTP 400 status', () => {
    const response = validationErrorResponse('title is required');
    expect(response.status).toBe(400);
  });

  it('returns success: false with the error message', async () => {
    const response = validationErrorResponse('title is required');
    const body = await parseResponse(response);
    expect(body).toMatchObject({ success: false, error: 'title is required' });
  });

  it('includes meta when provided', async () => {
    const response = validationErrorResponse('bad input', { requestId: 'abc' });
    const body = await parseResponse(response);
    expect(body).toMatchObject({ success: false, meta: { requestId: 'abc' } });
  });

  it('omits meta when not provided', async () => {
    const response = validationErrorResponse('bad input');
    const body = await parseResponse(response) as Record<string, unknown>;
    expect(body).not.toHaveProperty('meta');
  });
});

describe('serviceUnavailableResponse', () => {
  it('returns HTTP 503 status', () => {
    const response = serviceUnavailableResponse('GitHub API not configured');
    expect(response.status).toBe(503);
  });

  it('returns success: false with the error message', async () => {
    const response = serviceUnavailableResponse('GitHub API not configured');
    const body = await parseResponse(response);
    expect(body).toMatchObject({ success: false, error: 'GitHub API not configured' });
  });

  it('includes meta when provided', async () => {
    const response = serviceUnavailableResponse('AI not available', { aiEnabled: false });
    const body = await parseResponse(response);
    expect(body).toMatchObject({ success: false, meta: { aiEnabled: false } });
  });
});

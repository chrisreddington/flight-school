import { describe, expect, it } from 'vitest';
import { apiSuccess, validationErrorResponse, serviceUnavailableResponse } from './response-utils';

async function parseResponse(response: Response): Promise<{ body: unknown; status: number }> {
  const body = await response.json();
  return { body, status: response.status };
}

describe('apiSuccess', () => {
  it('should return 200 status', async () => {
    const response = apiSuccess({ id: 1 });
    const { status } = await parseResponse(response);
    expect(status).toBe(200);
  });

  it('should include success:true in body', async () => {
    const response = apiSuccess({ id: 1 });
    const { body } = await parseResponse(response);
    expect((body as Record<string, unknown>).success).toBe(true);
  });

  it('should include data in body', async () => {
    const data = { id: 1, name: 'test' };
    const response = apiSuccess(data);
    const { body } = await parseResponse(response);
    expect((body as Record<string, unknown>).data).toEqual(data);
  });

  it('should include meta when provided', async () => {
    const meta = { totalTimeMs: 42 };
    const response = apiSuccess({ id: 1 }, meta);
    const { body } = await parseResponse(response);
    expect((body as Record<string, unknown>).meta).toEqual(meta);
  });

  it('should omit meta when not provided', async () => {
    const response = apiSuccess({ id: 1 });
    const { body } = await parseResponse(response);
    expect((body as Record<string, unknown>).meta).toBeUndefined();
  });

  it('should handle array data', async () => {
    const data = [1, 2, 3];
    const response = apiSuccess(data);
    const { body } = await parseResponse(response);
    expect((body as Record<string, unknown>).data).toEqual(data);
  });

  it('should handle null data', async () => {
    const response = apiSuccess(null);
    const { body } = await parseResponse(response);
    expect((body as Record<string, unknown>).data).toBeNull();
  });
});

describe('validationErrorResponse', () => {
  it('should return 400 status', async () => {
    const response = validationErrorResponse('Invalid input');
    const { status } = await parseResponse(response);
    expect(status).toBe(400);
  });

  it('should include success:false in body', async () => {
    const response = validationErrorResponse('Invalid input');
    const { body } = await parseResponse(response);
    expect((body as Record<string, unknown>).success).toBe(false);
  });

  it('should include the error message in body', async () => {
    const response = validationErrorResponse('title is required');
    const { body } = await parseResponse(response);
    expect((body as Record<string, unknown>).error).toBe('title is required');
  });

  it('should include meta when provided', async () => {
    const meta = { totalTimeMs: 10 };
    const response = validationErrorResponse('bad input', meta);
    const { body } = await parseResponse(response);
    expect((body as Record<string, unknown>).meta).toEqual(meta);
  });

  it('should omit meta when not provided', async () => {
    const response = validationErrorResponse('bad input');
    const { body } = await parseResponse(response);
    expect((body as Record<string, unknown>).meta).toBeUndefined();
  });
});

describe('serviceUnavailableResponse', () => {
  it('should return 503 status', async () => {
    const response = serviceUnavailableResponse('Service down');
    const { status } = await parseResponse(response);
    expect(status).toBe(503);
  });

  it('should include success:false in body', async () => {
    const response = serviceUnavailableResponse('Service down');
    const { body } = await parseResponse(response);
    expect((body as Record<string, unknown>).success).toBe(false);
  });

  it('should include the error message in body', async () => {
    const response = serviceUnavailableResponse('GitHub API not configured');
    const { body } = await parseResponse(response);
    expect((body as Record<string, unknown>).error).toBe('GitHub API not configured');
  });

  it('should include meta when provided', async () => {
    const meta = { reason: 'no_token' };
    const response = serviceUnavailableResponse('unavailable', meta);
    const { body } = await parseResponse(response);
    expect((body as Record<string, unknown>).meta).toEqual(meta);
  });

  it('should omit meta when not provided', async () => {
    const response = serviceUnavailableResponse('unavailable');
    const { body } = await parseResponse(response);
    expect((body as Record<string, unknown>).meta).toBeUndefined();
  });
});

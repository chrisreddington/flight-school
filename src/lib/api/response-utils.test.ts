/**
 * Tests for API Response Utilities
 *
 * Tests standardized response builders used across all API routes.
 */

import { describe, expect, it } from 'vitest';
import { apiSuccess, validationErrorResponse, serviceUnavailableResponse } from './response-utils';

// =============================================================================
// Helpers
// =============================================================================

/** Extract the parsed JSON body from a NextResponse. */
async function parseBody(response: Response): Promise<unknown> {
  return response.json();
}

// =============================================================================
// apiSuccess Tests
// =============================================================================

describe('apiSuccess', () => {
  it('should return a 200 status response', async () => {
    const response = apiSuccess({ id: '1' });
    expect(response.status).toBe(200);
  });

  it('should include success: true in the body', async () => {
    const response = apiSuccess({ value: 42 });
    const body = await parseBody(response);
    expect(body).toMatchObject({ success: true });
  });

  it('should include the data in the body', async () => {
    const data = { id: '123', name: 'test' };
    const response = apiSuccess(data);
    const body = await parseBody(response) as { data: unknown };
    expect(body.data).toEqual(data);
  });

  it('should include meta when provided', async () => {
    const meta = { totalTimeMs: 100, aiEnabled: true };
    const response = apiSuccess({ result: 'ok' }, meta);
    const body = await parseBody(response) as { meta: unknown };
    expect(body.meta).toEqual(meta);
  });

  it('should omit meta key when not provided', async () => {
    const response = apiSuccess({ result: 'ok' });
    const body = await parseBody(response) as Record<string, unknown>;
    expect('meta' in body).toBe(false);
  });

  it('should handle array data', async () => {
    const data = [1, 2, 3];
    const response = apiSuccess(data);
    const body = await parseBody(response) as { data: unknown };
    expect(body.data).toEqual([1, 2, 3]);
  });

  it('should handle null data', async () => {
    const response = apiSuccess(null);
    const body = await parseBody(response) as { data: unknown };
    expect(body.data).toBeNull();
  });

  it('should handle string data', async () => {
    const response = apiSuccess('hello');
    const body = await parseBody(response) as { data: unknown };
    expect(body.data).toBe('hello');
  });
});

// =============================================================================
// validationErrorResponse Tests
// =============================================================================

describe('validationErrorResponse', () => {
  it('should return a 400 status response', async () => {
    const response = validationErrorResponse('name is required');
    expect(response.status).toBe(400);
  });

  it('should include success: false in the body', async () => {
    const response = validationErrorResponse('invalid input');
    const body = await parseBody(response);
    expect(body).toMatchObject({ success: false });
  });

  it('should include the error message in the body', async () => {
    const response = validationErrorResponse('title is required');
    const body = await parseBody(response) as { error: string };
    expect(body.error).toBe('title is required');
  });

  it('should include meta when provided', async () => {
    const meta = { totalTimeMs: 5 };
    const response = validationErrorResponse('bad input', meta);
    const body = await parseBody(response) as { meta: unknown };
    expect(body.meta).toEqual(meta);
  });

  it('should omit meta key when not provided', async () => {
    const response = validationErrorResponse('bad input');
    const body = await parseBody(response) as Record<string, unknown>;
    expect('meta' in body).toBe(false);
  });

  it.each([
    'name is required',
    'Request body is required and must be an object',
    'challengeId must not be empty',
  ])('should preserve the error message: %s', async (message) => {
    const response = validationErrorResponse(message);
    const body = await parseBody(response) as { error: string };
    expect(body.error).toBe(message);
  });
});

// =============================================================================
// serviceUnavailableResponse Tests
// =============================================================================

describe('serviceUnavailableResponse', () => {
  it('should return a 503 status response', async () => {
    const response = serviceUnavailableResponse('GitHub API not configured');
    expect(response.status).toBe(503);
  });

  it('should include success: false in the body', async () => {
    const response = serviceUnavailableResponse('service down');
    const body = await parseBody(response);
    expect(body).toMatchObject({ success: false });
  });

  it('should include the error message in the body', async () => {
    const message = 'GitHub API not configured';
    const response = serviceUnavailableResponse(message);
    const body = await parseBody(response) as { error: string };
    expect(body.error).toBe(message);
  });

  it('should include meta when provided', async () => {
    const meta = { totalTimeMs: 10, service: 'github' };
    const response = serviceUnavailableResponse('unavailable', meta);
    const body = await parseBody(response) as { meta: unknown };
    expect(body.meta).toEqual(meta);
  });

  it('should omit meta key when not provided', async () => {
    const response = serviceUnavailableResponse('unavailable');
    const body = await parseBody(response) as Record<string, unknown>;
    expect('meta' in body).toBe(false);
  });
});

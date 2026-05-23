import { describe, expect, it, vi } from 'vitest';
import { CopilotEntitlementRequiredError } from '@/lib/copilot/entitlement';
import { knownApiErrorResponse } from './auth-errors';

const { UnauthorizedError } = vi.hoisted(() => {
  class UnauthorizedError extends Error {
    readonly status = 401;

    constructor(message = 'Authentication required') {
      super(message);
      this.name = 'UnauthorizedError';
    }
  }

  return { UnauthorizedError };
});

vi.mock('@/lib/auth/context', () => ({
  UnauthorizedError,
}));

describe('API known error mapping', () => {
  it('should map Copilot entitlement errors before generic failures', async () => {
    const response = knownApiErrorResponse(new CopilotEntitlementRequiredError('Need Copilot'));

    expect(response?.status).toBe(402);
    await expect(response?.json()).resolves.toMatchObject({
      error: 'copilot_required',
      message: 'Need Copilot',
    });
  });

  it('should map auth failures to the standard unauthorized response', async () => {
    const response = knownApiErrorResponse(new UnauthorizedError('Please sign in'));

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({ error: 'Please sign in' });
  });

  it('should return null for unrelated errors', () => {
    expect(knownApiErrorResponse(new Error('Unexpected'))).toBeNull();
  });
});

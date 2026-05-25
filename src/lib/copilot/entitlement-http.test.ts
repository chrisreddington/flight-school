/**
 * Tests for the HTTP mapping of CopilotEntitlementRequiredError → 402 (P5).
 */

import { describe, expect, it } from 'vitest';

import { CopilotEntitlementRequiredError } from './entitlement';
import { copilotEntitlementErrorResponse } from './entitlement-http';

describe('copilotEntitlementErrorResponse', () => {
  it('returns null for unrelated errors', () => {
    expect(copilotEntitlementErrorResponse(new Error('nope'))).toBeNull();
    expect(copilotEntitlementErrorResponse(null)).toBeNull();
    expect(copilotEntitlementErrorResponse(undefined)).toBeNull();
  });

  it('maps a typed entitlement error to 402 with the standard body', async () => {
    const err = new CopilotEntitlementRequiredError('Need Copilot');
    const res = copilotEntitlementErrorResponse(err);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(402);
    const body = await res!.json();
    expect(body).toEqual({
      error: 'copilot_required',
      message: 'Need Copilot',
      signUpUrl: 'https://github.com/features/copilot',
    });
  });

  it('matches errors by stable name (cross-realm safe)', () => {
    const e = new Error('plain');
    e.name = 'CopilotEntitlementRequiredError';
    const res = copilotEntitlementErrorResponse(e);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(402);
  });

  // Copilot is the only AI route. Users without a Copilot entitlement
  // get a 402 with no `fallback` hint — there is no alternative provider
  // to point at.
  it('never includes a `fallback` field in the 402 body', async () => {
    const res = copilotEntitlementErrorResponse(new CopilotEntitlementRequiredError());
    const body = await res!.json();
    expect(body).not.toHaveProperty('fallback');
  });

  it('ignores any legacy COPILOT_REQUIRED=false escape hatch', async () => {
    const ORIGINAL = process.env.COPILOT_REQUIRED;
    process.env.COPILOT_REQUIRED = 'false';
    try {
      const res = copilotEntitlementErrorResponse(new CopilotEntitlementRequiredError('still required'));
      expect(res!.status).toBe(402);
      const body = await res!.json();
      expect(body).toEqual({
        error: 'copilot_required',
        message: 'still required',
        signUpUrl: 'https://github.com/features/copilot',
      });
    } finally {
      if (ORIGINAL === undefined) delete process.env.COPILOT_REQUIRED;
      else process.env.COPILOT_REQUIRED = ORIGINAL;
    }
  });
});

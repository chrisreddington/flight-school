/**
 * Tests for the HTTP mapping of CopilotEntitlementRequiredError → 402 (P5).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CopilotEntitlementRequiredError } from './entitlement';
import { copilotEntitlementErrorResponse } from './entitlement-http';

describe('copilotEntitlementErrorResponse', () => {
  const ORIGINAL = process.env.COPILOT_REQUIRED;

  beforeEach(() => {
    delete process.env.COPILOT_REQUIRED;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.COPILOT_REQUIRED;
    } else {
      process.env.COPILOT_REQUIRED = ORIGINAL;
    }
  });

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

  it('returns the deferred-fallback shape when COPILOT_REQUIRED=false', async () => {
    process.env.COPILOT_REQUIRED = 'false';
    const res = copilotEntitlementErrorResponse(new CopilotEntitlementRequiredError());
    expect(res!.status).toBe(402);
    const body = await res!.json();
    expect(body.error).toBe('copilot_required');
    expect(body.fallback).toBe('github_models_pending');
  });
});

/**
 * Tests for Copilot entitlement detection, error type, and per-user
 * sticky-negative cache (P5).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearNegativeEntitlement,
  CopilotEntitlementRequiredError,
  COPILOT_ENTITLEMENT_ERROR_NAME,
  hasNegativeEntitlement,
  isCopilotEntitlementError,
  markNegativeEntitlement,
  NEGATIVE_TTL_MS,
} from './entitlement';

describe('CopilotEntitlementRequiredError', () => {
  it('has a stable name field for HTTP-layer mapping', () => {
    const err = new CopilotEntitlementRequiredError();
    expect(err.name).toBe(COPILOT_ENTITLEMENT_ERROR_NAME);
    expect(err.name).toBe('CopilotEntitlementRequiredError');
    expect(err).toBeInstanceOf(Error);
  });

  it('exposes a sign-up URL and stable error code', () => {
    const err = new CopilotEntitlementRequiredError();
    expect(err.code).toBe('copilot_required');
    expect(err.signUpUrl).toBe('https://github.com/features/copilot');
  });

  it('preserves an underlying cause', () => {
    const inner = new Error('boom');
    const err = new CopilotEntitlementRequiredError('outer', inner);
    expect(err.cause).toBe(inner);
  });
});

describe('isCopilotEntitlementError', () => {
  it('returns false for nullish / unrelated inputs', () => {
    expect(isCopilotEntitlementError(null)).toBe(false);
    expect(isCopilotEntitlementError(undefined)).toBe(false);
    expect(isCopilotEntitlementError('boom')).toBe(false);
    expect(isCopilotEntitlementError(new Error('network timeout'))).toBe(false);
    expect(isCopilotEntitlementError(new Error('ECONNREFUSED'))).toBe(false);
  });

  it('matches the typed CopilotEntitlementRequiredError', () => {
    expect(isCopilotEntitlementError(new CopilotEntitlementRequiredError())).toBe(true);
  });

  it.each([
    'User is not entitled to Copilot',
    'No active Copilot subscription on this account',
    'A Copilot subscription is required',
    'Copilot license required for this action',
    'Copilot is not enabled for this user',
    'Copilot not available for the supplied token',
    'User is not a Copilot user',
    'requires a Copilot subscription',
    'copilot_required',
    'HTTP 403 Forbidden from Copilot backend',
    'Copilot returned 401 Unauthorized',
  ])('matches known entitlement message: %s', (message) => {
    expect(isCopilotEntitlementError(new Error(message))).toBe(true);
  });

  it('matches JSON-RPC ResponseError-shaped objects with auth codes', () => {
    const responseErr = { code: -32001, message: 'Forbidden: copilot access denied' };
    expect(isCopilotEntitlementError(responseErr)).toBe(true);

    const otherCode = { code: -32603, message: 'Internal error' };
    expect(isCopilotEntitlementError(otherCode)).toBe(false);
  });

  it('ignores auth-bucket codes when message is unrelated', () => {
    expect(isCopilotEntitlementError({ code: -32001, message: 'invalid params' })).toBe(false);
  });

  it('does not over-match generic 403/401 errors without a Copilot hint', () => {
    expect(isCopilotEntitlementError(new Error('403 Forbidden'))).toBe(false);
    expect(isCopilotEntitlementError(new Error('401 Unauthorized'))).toBe(false);
  });
});

describe('per-user sticky-negative cache', () => {
  beforeEach(() => {
    clearNegativeEntitlement();
  });

  afterEach(() => {
    clearNegativeEntitlement();
  });

  it('returns false before any negative mark', () => {
    expect(hasNegativeEntitlement('user-a')).toBe(false);
  });

  it('returns true within the TTL window after marking', () => {
    const t0 = 1_000_000;
    markNegativeEntitlement('user-a', t0);
    expect(hasNegativeEntitlement('user-a', t0)).toBe(true);
    expect(hasNegativeEntitlement('user-a', t0 + NEGATIVE_TTL_MS - 1)).toBe(true);
  });

  it('isolates per-user verdicts', () => {
    const t0 = 1_000_000;
    markNegativeEntitlement('user-a', t0);
    expect(hasNegativeEntitlement('user-a', t0)).toBe(true);
    expect(hasNegativeEntitlement('user-b', t0)).toBe(false);
  });

  it('expires after 5 minutes', () => {
    const t0 = 1_000_000;
    markNegativeEntitlement('user-a', t0);
    expect(hasNegativeEntitlement('user-a', t0 + NEGATIVE_TTL_MS + 1)).toBe(false);
    // and the entry is evicted lazily
    expect(hasNegativeEntitlement('user-a', t0 + NEGATIVE_TTL_MS + 2)).toBe(false);
  });

  it('clearNegativeEntitlement(userId) removes only that user', () => {
    const t0 = 1_000_000;
    markNegativeEntitlement('user-a', t0);
    markNegativeEntitlement('user-b', t0);
    clearNegativeEntitlement('user-a');
    expect(hasNegativeEntitlement('user-a', t0)).toBe(false);
    expect(hasNegativeEntitlement('user-b', t0)).toBe(true);
  });

  it('NEGATIVE_TTL_MS is 5 minutes (documented contract)', () => {
    expect(NEGATIVE_TTL_MS).toBe(5 * 60 * 1000);
  });
});

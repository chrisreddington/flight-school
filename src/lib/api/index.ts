/**
 * API Utilities
 *
 * Central export point for API utility modules. Provides consistent patterns
 * for API route development.
 *
 * @module api
 */

export { authErrorResponse, handleUnauthorizedError, knownApiErrorResponse } from './auth-errors';
export { parseJsonBody, parseJsonBodyWithFallback } from './request-utils';
export { validationErrorResponse } from './response-utils';
export { validateObject, validateRequiredString } from './validation-utils';
export { createStorageRoute } from './storage-route-factory';

/**
 * API Utilities
 * 
 * Central export point for all API utility modules.
 * Provides consistent patterns for API route development.
 * 
 * @module api
 */

// Request handling
export { authErrorResponse, handleUnauthorizedError, knownApiErrorResponse } from './auth-errors';
export { parseJsonBody, parseJsonBodyWithFallback } from './request-utils';

// Response handling
export {
    apiSuccess,
    validationErrorResponse
} from './response-utils';

// Validation
export { validateObject, validateRequiredString } from './validation-utils';

// Streaming utilities
export { createSSEResponse } from './streaming-utils';

// Storage route factory
export { createStorageRoute } from './storage-route-factory';

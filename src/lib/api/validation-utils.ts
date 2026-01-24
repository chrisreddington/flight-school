/**
 * API Validation Utilities
 * 
 * Composable validation helpers for API request bodies.
 * Reduces boilerplate and standardizes error messages.
 * 
 * @module api/validation-utils
 */

/**
 * Validates that a value is an object.
 * 
 * @param value - Value to validate
 * @param fieldName - Field name for error message
 * @returns Error message if invalid, null if valid
 * 
 * @example
 * ```typescript
 * const error = validateObject(body, 'Request body');
 * if (error) return errorResponse(error);
 * ```
 */
export function validateObject(value: unknown, fieldName: string): string | null {
  if (!value || typeof value !== 'object') {
    return `${fieldName} is required and must be an object`;
  }
  return null;
}

/**
 * Validates a required string field.
 *
 * @param value - Value to validate
 * @param fieldName - Human-readable field name for error messages
 * @returns Error message if invalid, null if valid
 *
 * @example
 * ```typescript
 * const error = validateRequiredString(title, 'title');
 * ```
 */
export function validateRequiredString(
  value: unknown,
  fieldName: string
): string | null {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    return `${fieldName} is required`;
  }
  return null;
}

/**
 * Lenient JSON parsing shared by the storage read-through and legacy importer.
 *
 * @module storage/json
 */

/**
 * Parse a raw file body, returning the parsed value on success or `undefined`
 * when the body is empty/whitespace or not valid JSON.
 *
 * @remarks
 * Corrupt and empty bodies collapse to the same `undefined` so callers can
 * treat an unreadable legacy file exactly like a missing one. Callers that need
 * to log the corruption should branch on the `undefined` return at their site.
 */
export function tryParseJson(raw: string): unknown {
  if (raw.trim().length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * The single source of truth for the "safe path segment" character class.
 *
 * A path segment that a caller embeds into a per-user storage path (a userId,
 * a `{challengeId}`, a catalog `trackId`/`stepId`) MUST be free of `..`, `/`,
 * and `.` so it can never traverse out of its partition. {@link SAFE_PATH_SEGMENT}
 * is that guard.
 *
 * This module is deliberately **dependency-free** — it imports nothing, not even
 * `'server-only'`. That lets backend-portable domain code (e.g. the tracks
 * catalog and id helpers) validate ids against the exact same class the storage
 * adapters enforce, without dragging a server-only marker — or any transitive
 * storage-adapter code — into a module that must stay environment-neutral.
 *
 * @module storage/safe-segment
 */

/**
 * Allowed characters in a path segment embedded into a per-user storage path.
 * Alphanumeric plus `_` and `-`; anything containing `..`, `/`, or `.` is
 * rejected. Both {@link import('./user-scope').SAFE_USER_ID} and the storage
 * adapters validate against this exact class, so there is one definition in the
 * codebase and every layer agrees on what "safe" means.
 */
export const SAFE_PATH_SEGMENT = /^[a-zA-Z0-9_-]+$/;

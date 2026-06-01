/**
 * Shared, adapter-neutral helpers for the document store.
 *
 * These cover the two places where the file and sqlite adapters (and the
 * migrator) must behave identically: how indexed metadata is normalised
 * before it is persisted, and how `list` pagination cursors are encoded.
 * Keeping them here guarantees the adapters cannot drift on either.
 *
 * @module storage/document-store/canonical
 */

import { DocumentConflictError, type DocumentMetadata } from './types';

/** The four indexed metadata fields, in a fixed order for stable hashing. */
const INDEXED_FIELDS: readonly (keyof DocumentMetadata)[] = ['type', 'status', 'parentId', 'sortKey'];

/**
 * Recursively rebuild a JSON value into a canonical shape: object keys are
 * sorted, keys whose value is `undefined` are dropped, and `null` is kept
 * verbatim. Arrays keep their order (it is semantically significant) but each
 * element is canonicalised; an `undefined` array element becomes `null` to
 * match `JSON.stringify` and keep length stable. Primitives pass through.
 *
 * Domain bodies use `null` meaningfully (e.g. the profile cache stores `null`
 * to mean "no cached profile"), so — unlike {@link canonicalizeMetadata} —
 * `null` must survive. The migrator hashes the result to decide insert vs.
 * skip, so the ordering must be total and deterministic.
 */
function canonicalizeValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((element) => (element === undefined ? null : canonicalizeValue(element)));
  }
  const source = value as Record<string, unknown>;
  const canonical: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const fieldValue = source[key];
    if (fieldValue === undefined) continue;
    canonical[key] = canonicalizeValue(fieldValue);
  }
  return canonical;
}

/**
 * Serialise a document body to a canonical JSON string for content hashing.
 * Stable across key insertion order and `undefined`-vs-absent differences,
 * while preserving `null`. Two bodies that are deeply equal up to those
 * normalisations produce byte-identical strings; any real difference (a
 * changed value, an added key, a reordered array) produces a different one.
 *
 * Used by the file→sqlite migrator's insert-if-absent conflict policy: it
 * compares `canonicalizeBody(source)` against `canonicalizeBody(target)`
 * rather than a persisted hash, so a conservative serialisation failure
 * surfaces as a false "diverged" (skip + log) rather than a silent overwrite.
 */
export function canonicalizeBody(body: unknown): string {
  return JSON.stringify(canonicalizeValue(body));
}

/**
 * Normalise metadata for storage: keep only the four indexed fields, and
 * omit any that are `null` or `undefined`. Domain bodies may use `null`
 * meaningfully, but indexed metadata is a query surface where an absent
 * field and a null field must be indistinguishable across adapters.
 */
export function canonicalizeMetadata(metadata?: DocumentMetadata): DocumentMetadata {
  const canonical: DocumentMetadata = {};
  if (!metadata) return canonical;
  for (const field of INDEXED_FIELDS) {
    const value = metadata[field];
    if (value !== undefined && value !== null) {
      canonical[field] = value;
    }
  }
  return canonical;
}

/**
 * Encode a pagination cursor from the ordering value and id of the last
 * returned item. The pair `(orderValue, id)` is the stable tie-break the
 * `documents` indexes are built around, so the cursor is deterministic even
 * when many rows share an ordering value.
 */
export function encodeCursor(orderValue: string, id: string): string {
  return Buffer.from(JSON.stringify([orderValue, id]), 'utf-8').toString('base64url');
}

/** The `(orderValue, id)` pair decoded from a pagination cursor. */
export interface DecodedCursor {
  orderValue: string;
  id: string;
}

/**
 * Decode a cursor produced by {@link encodeCursor}. Returns null for a
 * malformed cursor so callers can treat it as "start from the beginning"
 * rather than crashing on attacker-supplied input.
 */
export function decodeCursor(cursor: string): DecodedCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string'
    ) {
      return { orderValue: parsed[0], id: parsed[1] };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Reject a {@link PutOptions} that sets both `ifMatch` and `ifNoneMatch`.
 *
 * The two preconditions are mutually exclusive — `ifMatch` is an
 * update-if-unchanged CAS, `ifNoneMatch: '*'` is a create-if-absent CAS — and
 * the type system already forbids the combination for TypeScript callers. This
 * runtime guard is the parity backstop: every adapter calls it first, so a
 * dynamically-built or `as`-cast options object can never make one backend
 * honour `ifMatch` while another honours `ifNoneMatch`. Throwing
 * {@link DocumentConflictError} keeps the failure mode identical to a real CAS
 * miss, which is what callers already handle.
 */
export function assertExclusiveCas(options: { ifMatch?: string; ifNoneMatch?: '*' }): void {
  if (options.ifMatch !== undefined && options.ifNoneMatch !== undefined) {
    throw new DocumentConflictError('put: ifMatch and ifNoneMatch are mutually exclusive');
  }
}

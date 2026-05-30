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

import type { DocumentMetadata } from './types';

/** The four indexed metadata fields, in a fixed order for stable hashing. */
const INDEXED_FIELDS: readonly (keyof DocumentMetadata)[] = ['type', 'status', 'parentId', 'sortKey'];

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

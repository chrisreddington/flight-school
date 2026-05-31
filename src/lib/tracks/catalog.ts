/**
 * Catalog loader and lookups for the Tracks data layer (§B.1).
 *
 * {@link loadCatalog} is the *only* sanctioned way to read the curated catalog.
 * It validates — at load time — that every `trackId` and `stepId` is a safe
 * path segment and that ids are unique, so the rest of the data layer can embed
 * a catalog id into a storage path (or treat it as a slot key) without
 * re-checking. A catalog test calls `loadCatalog()` with the shipped data, so a
 * curator who adds an unsafe or duplicate id fails CI rather than production.
 *
 * Pure module: imports only the dependency-free safe-segment class, the catalog
 * data, and types. No storage, no `server-only`.
 *
 * @module tracks/catalog
 */

import { CATALOG, CATALOG_VERSION } from './catalog-data';
import { SAFE_PATH_SEGMENT } from '../storage/safe-segment';
import type { Catalog, Track, TrackStep } from './types';

/**
 * Validate and assemble the catalog.
 *
 * @param tracks - Catalog content to validate; defaults to the shipped
 *   {@link CATALOG}. The parameter exists so tests can prove the loader rejects
 *   unsafe/duplicate ids without mutating shipped data.
 * @returns A frozen-shape {@link Catalog} stamped with {@link CATALOG_VERSION}.
 * @throws {Error} when any id is unsafe or any trackId/stepId is duplicated.
 */
export function loadCatalog(tracks: readonly Track[] = CATALOG): Catalog {
  const seenTrackIds = new Set<string>();

  for (const track of tracks) {
    assertSafeCatalogId(track.trackId, 'trackId');
    if (seenTrackIds.has(track.trackId)) {
      throw new Error(`Duplicate trackId in catalog: ${track.trackId}`);
    }
    seenTrackIds.add(track.trackId);

    const seenStepIds = new Set<string>();
    for (const step of track.steps) {
      assertSafeCatalogId(step.stepId, 'stepId');
      if (seenStepIds.has(step.stepId)) {
        throw new Error(`Duplicate stepId in track ${track.trackId}: ${step.stepId}`);
      }
      seenStepIds.add(step.stepId);
    }
  }

  return { catalogVersion: CATALOG_VERSION, tracks };
}

/** Find a track by id, or `undefined` if the catalog has no such track. */
export function getTrack(catalog: Catalog, trackId: string): Track | undefined {
  return catalog.tracks.find((track) => track.trackId === trackId);
}

/** Find a step within a track, or `undefined` if either id is unknown. */
export function getStep(catalog: Catalog, trackId: string, stepId: string): TrackStep | undefined {
  return getTrack(catalog, trackId)?.steps.find((step) => step.stepId === stepId);
}

/**
 * Throw unless a curated catalog id is a safe path segment. Separate from the
 * repo's `assertSafeSegment` so the failure message names the offending field.
 */
function assertSafeCatalogId(id: string, field: 'trackId' | 'stepId'): void {
  if (!SAFE_PATH_SEGMENT.test(id)) {
    throw new Error(`Unsafe ${field} in catalog: ${JSON.stringify(id)}`);
  }
}

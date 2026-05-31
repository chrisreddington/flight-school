/**
 * The registry reconciliation sweep (§A.4) — a PURE, UNWIRED janitor that
 * removes registry entries whose user data no longer exists.
 *
 * Account deletion (`deleteUserData`) wipes data partitions FIRST and the
 * registry entry LAST, so a crash mid-delete leaves a registry entry pointing
 * at no data — a harmless residual the registry tolerates by design. This
 * sweep is how that residual is eventually reclaimed.
 *
 * CRITICAL: This function is intentionally NOT wired to any scheduler, route,
 * or worker. Running it live races account *creation*: `ensureUserRegistered`
 * writes the registry entry BEFORE the first data write, so a user who has
 * just registered but not yet written data looks identical to an abandoned
 * ghost. The `minAgeMs` age guard narrows — but does not close — that window
 * (a slow first write could still exceed it). Before this is ever scheduled,
 * registration must be reworked to stamp a `lastTouchedAt` the sweep can trust
 * (e.g. bump it on every data write) so "registered but mid-first-write" is
 * distinguishable from "registered long ago, data since deleted". Until then
 * this stays a tested-but-dormant primitive.
 *
 * @module storage/document-store/registry-reconciliation
 */

import { USER_SCOPED_CONTAINERS } from './containers';
import type { DocumentStore } from './types';
import { iterateRegisteredEntries, removeUserRegistration } from './user-registry';

/** Inputs to a single reconciliation pass. */
export interface ReconcileOptions {
  /**
   * Minimum age (ms since `registeredAt`) before an empty registration is
   * eligible for pruning. The age guard spares users mid-first-write; see the
   * module's `CRITICAL` note for why it is necessary but not sufficient.
   */
  minAgeMs: number;
  /** Current epoch ms; injectable so tests pin a deterministic clock. */
  now?: number;
}

/** What a reconciliation pass removed. */
export interface ReconcileOutcome {
  /** The user ids whose stale registry entries were pruned this pass. */
  pruned: string[];
}

/**
 * Whether a user still has any data in any user-scoped container. A single
 * one-item page per container is enough — the first non-empty partition short
 * circuits, so an active user costs one `list` call, not a full scan.
 */
async function userHasData(store: DocumentStore, userId: string): Promise<boolean> {
  for (const container of USER_SCOPED_CONTAINERS) {
    const firstPage = await store.list(container, userId, { limit: 1 });
    if (firstPage.items.length > 0) return true;
  }
  return false;
}

/**
 * Prune registry entries that are both older than `minAgeMs` AND have no
 * remaining data in any user-scoped container. A registration that is too
 * young, or whose user still has data, is left untouched. Pure: it mutates
 * only the store passed in and returns exactly what it pruned.
 */
export async function reconcileUserRegistry(
  store: DocumentStore,
  { minAgeMs, now = Date.now() }: ReconcileOptions,
): Promise<ReconcileOutcome> {
  const pruned: string[] = [];

  for await (const entry of iterateRegisteredEntries(store)) {
    const ageMs = now - Date.parse(entry.registeredAt);
    if (ageMs < minAgeMs) continue;
    if (await userHasData(store, entry.userId)) continue;

    await removeUserRegistration(store, entry.userId);
    pruned.push(entry.userId);
  }

  return { pruned };
}

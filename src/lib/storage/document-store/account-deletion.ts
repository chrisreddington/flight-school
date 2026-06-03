/**
 * Account-deletion partition wipe for the document store (§A.4, §A.9).
 *
 * {@link deleteUserData} is the multi-tenant teardown counterpart to user
 * registration: where registration writes the registry entry FIRST (so a
 * crash mid-create leaves a discoverable owner), deletion removes the registry
 * entry LAST and only when every data partition is gone — so a crash mid-wipe
 * leaves the registry entry behind, keeping the half-deleted account
 * discoverable and the operation safely retryable. Removing the registry first
 * would instead strand orphaned partitions no sweep could find.
 *
 * This module is Next-free and takes a resolved {@link DocumentStore}, so it
 * runs identically from a route handler, a worker job, or a background sweep.
 *
 * @module storage/document-store/account-deletion
 */

import { USER_SCOPED_CONTAINERS } from './containers';
import type { ContainerName, DocumentStore } from './types';
import { removeUserRegistration } from './user-registry';

/**
 * Which phase of {@link deleteUserData} failed.
 *
 * `partition` means one or more data partitions could not be cleared, so the
 * registry entry was deliberately left in place and the user's data is only
 * partially gone. `registry` means every partition was wiped but the final
 * registry-entry removal failed — the data IS gone, only the discoverable
 * owner record lingers.
 */
export type UserDataDeletionPhase = 'partition' | 'registry';

/**
 * Typed failure from {@link deleteUserData} that tells the caller WHICH phase
 * failed, so a route can report a partition failure as a partial,
 * data-still-present delete (do not sign out) versus a registry-only failure
 * as a completed data wipe with a lingering owner record (safe to sign out).
 */
export class UserDataDeletionError extends Error {
  readonly phase: UserDataDeletionPhase;
  readonly failedContainers: readonly ContainerName[];

  constructor(
    phase: UserDataDeletionPhase,
    failedContainers: readonly ContainerName[],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'UserDataDeletionError';
    this.phase = phase;
    this.failedContainers = failedContainers;
  }
}

/**
 * Delete every per-user partition for `userId`, then remove their registry
 * entry. Partition deletes are idempotent, so retrying after a partial failure
 * is safe: already-cleared partitions delete again as no-ops.
 *
 * @throws UserDataDeletionError with `phase: 'partition'` if any partition
 *   delete fails — the registry entry is left in place (the account stays
 *   discoverable) so the caller can retry; the message names the failed
 *   containers. Throws with `phase: 'registry'` if every partition cleared but
 *   the registry-entry removal failed — the data is gone, only the owner record
 *   lingers.
 */
export async function deleteUserData(store: DocumentStore, userId: string): Promise<void> {
  const failedContainers: ContainerName[] = [];

  for (const container of USER_SCOPED_CONTAINERS) {
    try {
      await store.deletePartition(container, userId);
    } catch {
      failedContainers.push(container);
    }
  }

  if (failedContainers.length > 0) {
    throw new UserDataDeletionError(
      'partition',
      failedContainers,
      `Failed to delete document-store partitions for ${userId}: ${failedContainers.join(', ')}`,
    );
  }

  try {
    await removeUserRegistration(store, userId);
  } catch (cause) {
    throw new UserDataDeletionError(
      'registry',
      [],
      `Deleted all partitions for ${userId} but failed to remove the registry entry`,
      { cause },
    );
  }
}

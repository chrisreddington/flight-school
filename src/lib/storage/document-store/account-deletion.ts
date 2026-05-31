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
 * Delete every per-user partition for `userId`, then remove their registry
 * entry. Partition deletes are idempotent, so retrying after a partial failure
 * is safe: already-cleared partitions delete again as no-ops.
 *
 * @throws Error if any partition delete fails — the registry entry is left in
 *   place (the account stays discoverable) so the caller can retry. The error
 *   names the containers that failed.
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
    throw new Error(`Failed to delete document-store partitions for ${userId}: ${failedContainers.join(', ')}`);
  }

  await removeUserRegistration(store, userId);
}

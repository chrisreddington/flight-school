/**
 * The roster of per-user containers an account wipe must clear (§A.9).
 *
 * Account deletion iterates THIS list and calls `deletePartition(container,
 * userId)` on each. The shared `system` container is deliberately excluded:
 * its partitions are keyed by registry shard / migration-state, NOT by
 * userId, so wiping a user's `system` partition would either no-op or, worse,
 * corrupt cross-cutting global state. A user's registry ENTRY is removed
 * separately by the deletion helper, never by a partition wipe.
 *
 * @module storage/document-store/containers
 */

import type { ContainerName } from './types';

/**
 * Every container partitioned by userId, so an account wipe knows exactly
 * which partitions to delete. Excludes `system` (see the module note).
 *
 * The `satisfies` clause pins the array's element type to the non-`system`
 * half of {@link ContainerName}; the exhaustiveness assertion below then
 * fails the build if a new per-user container is added to the union but not
 * to this list.
 */
export const USER_SCOPED_CONTAINERS = [
  'skills',
  'habits',
  'focus',
  'profile',
  'challenges',
  'challenge-queue',
  'threads',
  'evaluations',
  'activity',
  'workspaces',
  'track-enrollments',
  'track-steps',
] as const satisfies readonly Exclude<ContainerName, 'system'>[];

/**
 * Compile-time guard: `true` only when every non-`system` `ContainerName`
 * appears in {@link USER_SCOPED_CONTAINERS}. Adding a per-user container to
 * the union without listing it here makes this type `never`, so the
 * assignment below stops compiling.
 */
type EveryUserContainerListed =
  Exclude<ContainerName, 'system'> extends (typeof USER_SCOPED_CONTAINERS)[number] ? true : never;

const _assertEveryUserContainerListed: EveryUserContainerListed = true;
void _assertEveryUserContainerListed;

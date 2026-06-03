/**
 * Tests for the user-scoped container roster (§A.9).
 *
 * `USER_SCOPED_CONTAINERS` is the single source of truth for which
 * containers an account-deletion wipe iterates. Two properties matter: the
 * `system` container is NEVER in the list (deleting a user's `system`
 * partition would corrupt the shared registry), and the list stays in sync
 * with the `ContainerName` union as containers are added.
 */

import { describe, expect, it } from 'vitest';

import { USER_SCOPED_CONTAINERS } from './containers';

describe('USER_SCOPED_CONTAINERS', () => {
  it('never includes the shared system container', () => {
    expect(USER_SCOPED_CONTAINERS).not.toContain('system');
  });

  it('lists every per-user container exactly once', () => {
    const unique = new Set(USER_SCOPED_CONTAINERS);
    expect(unique.size).toBe(USER_SCOPED_CONTAINERS.length);
  });

  it('covers the known per-user containers', () => {
    expect([...USER_SCOPED_CONTAINERS].sort()).toEqual(
      [
        'activity',
        'challenge-queue',
        'challenges',
        'evaluations',
        'focus',
        'habits',
        'profile',
        'skills',
        'threads',
        'track-enrollments',
        'track-steps',
        'workspaces',
      ].sort(),
    );
  });
});

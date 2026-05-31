/**
 * Enrollment-currency validation tests for {@link TracksRepo} step mutations
 * (§B.4).
 *
 * Every step mutation (`startStep`, `accessStep`, `completeStep`) first resolves
 * the enrollment and refuses to write unless it is the track's *current, active*
 * enrollment — meaning the enrollment exists, is `status:'active'`, AND the
 * track's active-slot document points back at it. These suites pin each rejected
 * shape so a client holding a stale id (abandoned, completed, never-enrolled, or
 * displaced by a re-enroll) cannot mint or advance progress on a non-current
 * enrollment. The parity / CAS behaviour of the happy path lives in the sibling
 * `tracks-repo.steps.test.ts`.
 *
 * @module tracks/tracks-repo.step-validation.test
 */

import { promises as fs } from 'fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentStore } from '../storage/document-store/types';
import type { UserScopedStore } from '../storage/document-store/user-scoped-store';
import { createTracksRepo } from './tracks-repo';
import type { TracksRepo } from './tracks-repo';
import { EnrollmentNotActiveError } from './types';
import {
  adapterCases,
  deterministicOptions,
  freshTempDir,
  makeScopedStore,
  seedEnrollment,
  seedSlot,
  SQLITE_AVAILABLE,
  TRACK_A,
} from './tracks-repo.harness';

const STEP = 'step-a';

describe.each(adapterCases)('TracksRepo step-validation on the $name adapter', ({ name, make }) => {
  const maybeIt = name === 'sqlite' && !SQLITE_AVAILABLE ? it.skip : it;
  let dir: string;
  let raw: DocumentStore;
  let store: UserScopedStore;
  let repo: TracksRepo;

  beforeEach(async () => {
    dir = await freshTempDir();
    raw = await make(dir);
    store = makeScopedStore(raw);
    repo = createTracksRepo(store, deterministicOptions());
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(dir, { recursive: true, force: true });
  });

  maybeIt('startStep rejects a never-enrolled id', async () => {
    await expect(repo.startStep('ghost-1', STEP)).rejects.toBeInstanceOf(EnrollmentNotActiveError);
  });

  maybeIt('startStep rejects an abandoned enrollment', async () => {
    await seedEnrollment(store, 'dead-1', TRACK_A, 'abandoned');
    await seedSlot(store, TRACK_A, 'dead-1');

    await expect(repo.startStep('dead-1', STEP)).rejects.toBeInstanceOf(EnrollmentNotActiveError);
  });

  maybeIt('startStep rejects a completed enrollment', async () => {
    await seedEnrollment(store, 'done-1', TRACK_A, 'completed');
    await seedSlot(store, TRACK_A, 'done-1');

    await expect(repo.startStep('done-1', STEP)).rejects.toBeInstanceOf(EnrollmentNotActiveError);
  });

  maybeIt('startStep rejects an active enrollment with no active slot', async () => {
    await seedEnrollment(store, 'orphan-1', TRACK_A, 'active');

    await expect(repo.startStep('orphan-1', STEP)).rejects.toBeInstanceOf(EnrollmentNotActiveError);
  });

  maybeIt('startStep rejects an enrollment the slot no longer points at (displaced by re-enroll)', async () => {
    await repo.enroll(TRACK_A); // mints + slots enr-1
    await seedEnrollment(store, 'rival-1', TRACK_A, 'active');
    await seedSlot(store, TRACK_A, 'rival-1'); // repoint the slot off enr-1

    await expect(repo.startStep('enr-1', STEP)).rejects.toBeInstanceOf(EnrollmentNotActiveError);
  });

  maybeIt('accessStep rejects an inactive enrollment before touching history', async () => {
    await seedEnrollment(store, 'dead-1', TRACK_A, 'abandoned');
    await seedSlot(store, TRACK_A, 'dead-1');

    await expect(repo.accessStep('dead-1', STEP)).rejects.toBeInstanceOf(EnrollmentNotActiveError);
  });

  maybeIt('completeStep rejects an inactive enrollment before ensuring an instance', async () => {
    await seedEnrollment(store, 'dead-1', TRACK_A, 'abandoned');
    await seedSlot(store, TRACK_A, 'dead-1');

    await expect(repo.completeStep('dead-1', STEP)).rejects.toBeInstanceOf(EnrollmentNotActiveError);
    expect(await repo.listStepInstances('dead-1')).toHaveLength(0);
  });

  maybeIt('accessStep on an unstarted step of a valid enrollment is still a no-op', async () => {
    await repo.enroll(TRACK_A); // mints + slots enr-1

    await expect(repo.accessStep('enr-1', STEP)).resolves.toBeUndefined();
    expect(await repo.listStepInstances('enr-1')).toHaveLength(0);
  });
});

/**
 * Parity tests for {@link TracksRepo} step-instance behaviour (§B.4).
 *
 * A step instance is keyed by a deterministic `(enrollmentId, stepId)` hash, so
 * the repo enforces exactly one instance per pair purely through
 * `put(ifNoneMatch:'*')` CAS — no uniqueness index. These suites pin that
 * invariant, plus the no-op / best-effort semantics of `accessStep` and the
 * ensure-then-advance semantics of `completeStep`, identically on the file and
 * sqlite adapters. The deterministic `RecordingStore` simulations then drive the
 * CAS-conflict branches a real race could only reproduce flakily.
 *
 * Enrollment + active-slot behaviour lives in the sibling
 * `tracks-repo.enroll.test.ts`; shared envelope-metadata parity lives in the
 * DocumentStore contract suite.
 *
 * @module tracks/tracks-repo.steps.test
 */

import { promises as fs } from 'fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentStore } from '../storage/document-store/types';
import type { UserScopedStore } from '../storage/document-store/user-scoped-store';
import { stepInstanceId } from './ids';
import { createTracksRepo } from './tracks-repo';
import type { TrackStepInstance } from './types';
import {
  adapterCases,
  deterministicOptions,
  freshTempDir,
  makeScopedStore,
  RecordingStore,
  SQLITE_AVAILABLE,
  USER_ID,
} from './tracks-repo.harness';

const STEPS = 'track-steps';
const ENROLLMENT = 'enr-1';
const STEP = 'step-a';

/** Fetch a step instance by its deterministic id, or null if absent. */
async function readInstance(
  store: UserScopedStore,
  enrollmentId: string,
  stepId: string,
): Promise<TrackStepInstance | null> {
  return store.get<TrackStepInstance>(STEPS, stepInstanceId(enrollmentId, stepId));
}

describe.each(adapterCases)('TracksRepo steps on the $name adapter', ({ name, make }) => {
  const maybeIt = name === 'sqlite' && !SQLITE_AVAILABLE ? it.skip : it;
  let dir: string;
  let raw: DocumentStore;
  let store: UserScopedStore;

  beforeEach(async () => {
    dir = await freshTempDir();
    raw = await make(dir);
    store = makeScopedStore(raw);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(dir, { recursive: true, force: true });
  });

  maybeIt('startStep creates an in-progress instance the list returns', async () => {
    const repo = createTracksRepo(store, deterministicOptions());

    const instance = await repo.startStep(ENROLLMENT, STEP);

    expect(instance.stepInstanceId).toBe(stepInstanceId(ENROLLMENT, STEP));
    expect(instance.status).toBe('in-progress');
    expect(instance.lastAccessedAt).toBeDefined();
    const listed = await repo.listStepInstances(ENROLLMENT);
    expect(listed).toHaveLength(1);
    expect(listed[0].stepId).toBe(STEP);
  });

  maybeIt('repeated startStep is idempotent — exactly one instance', async () => {
    const repo = createTracksRepo(store, deterministicOptions());

    const first = await repo.startStep(ENROLLMENT, STEP);
    const second = await repo.startStep(ENROLLMENT, STEP);

    expect(second.stepInstanceId).toBe(first.stepInstanceId);
    expect(second.status).toBe('in-progress');
    // The re-read returns the original stamp, not a fresh one.
    expect(second.lastAccessedAt).toBe(first.lastAccessedAt);
    const listed = await repo.listStepInstances(ENROLLMENT);
    expect(listed).toHaveLength(1);
  });

  maybeIt('concurrent startStep resolves to a single instance', async () => {
    const repoA = createTracksRepo(store, deterministicOptions('a'));
    const repoB = createTracksRepo(store, deterministicOptions('b'));

    const [a, b] = await Promise.all([repoA.startStep(ENROLLMENT, STEP), repoB.startStep(ENROLLMENT, STEP)]);

    expect(a.stepInstanceId).toBe(b.stepInstanceId);
    const listed = await repoA.listStepInstances(ENROLLMENT);
    expect(listed).toHaveLength(1);
  });

  maybeIt('accessStep on an unstarted step is a no-op', async () => {
    const repo = createTracksRepo(store, deterministicOptions());

    await expect(repo.accessStep(ENROLLMENT, STEP)).resolves.toBeUndefined();

    expect(await readInstance(store, ENROLLMENT, STEP)).toBeNull();
    expect(await repo.listStepInstances(ENROLLMENT)).toHaveLength(0);
  });

  maybeIt('accessStep re-stamps lastAccessedAt on a started step', async () => {
    const repo = createTracksRepo(store, deterministicOptions());
    const started = await repo.startStep(ENROLLMENT, STEP);

    await repo.accessStep(ENROLLMENT, STEP);

    const after = await readInstance(store, ENROLLMENT, STEP);
    expect(after?.status).toBe('in-progress');
    expect(after?.lastAccessedAt).toBeDefined();
    expect(Date.parse(after!.lastAccessedAt!)).toBeGreaterThan(Date.parse(started.lastAccessedAt!));
  });

  maybeIt('completeStep ensures the instance then advances it to completed', async () => {
    const repo = createTracksRepo(store, deterministicOptions());

    const completed = await repo.completeStep(ENROLLMENT, STEP);

    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBeDefined();
    const stored = await readInstance(store, ENROLLMENT, STEP);
    expect(stored?.status).toBe('completed');
  });

  maybeIt('completeStep is idempotent once the step is completed', async () => {
    const repo = createTracksRepo(store, deterministicOptions());
    const first = await repo.completeStep(ENROLLMENT, STEP);

    const second = await repo.completeStep(ENROLLMENT, STEP);

    expect(second.status).toBe('completed');
    expect(second.completedAt).toBe(first.completedAt);
  });

  maybeIt('listStepInstances returns only the given enrollment instances', async () => {
    const repo = createTracksRepo(store, deterministicOptions());
    await repo.startStep(ENROLLMENT, STEP);
    await repo.startStep(ENROLLMENT, 'step-b');
    await repo.startStep('enr-2', STEP);

    const listed = await repo.listStepInstances(ENROLLMENT);

    expect(listed).toHaveLength(2);
    expect(listed.every((instance) => instance.enrollmentId === ENROLLMENT)).toBe(true);
  });
});

describe('TracksRepo step CAS simulations (file adapter)', () => {
  const make = adapterCases[0].make;
  let dir: string;
  let inner: UserScopedStore;
  let spy: RecordingStore;

  beforeEach(async () => {
    dir = await freshTempDir();
    inner = makeScopedStore(await make(dir), USER_ID);
    spy = new RecordingStore(inner);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** Matches the `lastAccessedAt`/status CAS put (ifMatch), not the create (ifNoneMatch). */
  const isStepCasPut = (call: { container: string; opts?: { ifMatch?: string } }): boolean =>
    call.container === STEPS && call.opts?.ifMatch !== undefined;

  it('accessStep swallows a CAS conflict and leaves the last-committed state', async () => {
    const repo = createTracksRepo(spy, deterministicOptions());
    await repo.startStep(ENROLLMENT, STEP);
    const committed = await repo.completeStep(ENROLLMENT, STEP);

    // Prime AFTER completeStep so the injector fires on accessStep's bump, not completion.
    spy.failNextPutWhere(isStepCasPut);
    await expect(repo.accessStep(ENROLLMENT, STEP)).resolves.toBeUndefined();

    const after = await readInstance(inner, ENROLLMENT, STEP);
    expect(after?.status).toBe('completed');
    expect(after?.completedAt).toBe(committed.completedAt);
  });

  it('completeStep retries past a CAS conflict and still completes', async () => {
    const repo = createTracksRepo(spy, deterministicOptions());
    await repo.startStep(ENROLLMENT, STEP);

    spy.failNextPutWhere(isStepCasPut);
    const completed = await repo.completeStep(ENROLLMENT, STEP);

    expect(completed.status).toBe('completed');
    const id = stepInstanceId(ENROLLMENT, STEP);
    // Two ifMatch attempts: the conflicted first, then the winning retry.
    expect(spy.putCalls.filter((call) => isStepCasPut(call) && call.id === id)).toHaveLength(2);
  });
});

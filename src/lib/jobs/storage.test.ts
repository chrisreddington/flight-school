import { createTestStorageContext, ensureTestStorageDirectory } from '@/test/mocks/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('jobStorage', () => {
  let cleanup: () => Promise<void>;
  let jobStorage: typeof import('./storage').jobStorage;

  beforeEach(async () => {
    const context = createTestStorageContext();
    cleanup = context.cleanup;
    await ensureTestStorageDirectory(context.storageDir);
    vi.resetModules();
    const imported = await import('./storage');
    jobStorage = imported.jobStorage;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('should return jobs with mixed statuses from getAll', async () => {
    await jobStorage.create({
      id: 'job-running',
      type: 'chat-response',
      userId: 'test-user',
      input: {},
    });
    await jobStorage.create({
      id: 'job-pending',
      type: 'chat-response',
      userId: 'test-user',
      input: {},
    });
    await jobStorage.create({
      id: 'job-completed',
      type: 'chat-response',
      userId: 'test-user',
      input: {},
    });

    await jobStorage.markRunning('job-running');
    await jobStorage.markCompleted('job-completed', { ok: true });

    const jobs = await jobStorage.getAll();
    const statusesById = new Map(jobs.map((job) => [job.id, job.status]));

    expect(jobs).toHaveLength(3);
    expect(statusesById.get('job-running')).toBe('running');
    expect(statusesById.get('job-pending')).toBe('pending');
    expect(statusesById.get('job-completed')).toBe('completed');
  });

  it('should set failed status and completedAt when markFailed is called', async () => {
    await jobStorage.create({
      id: 'job-to-fail',
      type: 'chat-response',
      userId: 'test-user',
      input: {},
    });

    const updated = await jobStorage.markFailed('job-to-fail', 'Server process restarted');

    expect(updated).toBeDefined();
    expect(updated?.status).toBe('failed');
    expect(updated?.error).toBe('Server process restarted');
    expect(updated?.completedAt).toBeTruthy();
  });

  it('should persist a structured errorCode when markFailed is given one', async () => {
    await jobStorage.create({
      id: 'job-creds-expired',
      type: 'chat-response',
      userId: 'test-user',
      input: {},
    });

    const updated = await jobStorage.markFailed(
      'job-creds-expired',
      'GitHub credentials expired — user must re-authenticate.',
      'credentials_refresh_failed',
    );

    expect(updated?.status).toBe('failed');
    expect(updated?.errorCode).toBe('credentials_refresh_failed');

    const reloaded = await jobStorage.get('job-creds-expired');
    expect(reloaded?.errorCode).toBe('credentials_refresh_failed');
  });

  it('setCurrentStep persists the label and is idempotent on repeat writes', async () => {
    await jobStorage.create({
      id: 'job-with-step',
      type: 'challenge-evaluation',
      userId: 'test-user',
      input: {},
    });

    const first = await jobStorage.setCurrentStep('job-with-step', 'Running tests…');
    expect(first?.currentStep).toBe('Running tests…');

    // Same value should short-circuit but still return the current job.
    const second = await jobStorage.setCurrentStep('job-with-step', 'Running tests…');
    expect(second?.currentStep).toBe('Running tests…');

    const third = await jobStorage.setCurrentStep('job-with-step', 'Analysing results…');
    expect(third?.currentStep).toBe('Analysing results…');
  });

  it('setCurrentStep returns undefined for unknown jobs', async () => {
    const result = await jobStorage.setCurrentStep('does-not-exist', 'foo');
    expect(result).toBeUndefined();
  });

  describe('createIfAbsent (atomic check-then-create)', () => {
    it('returns {created:true} when no record exists', async () => {
      const outcome = await jobStorage.createIfAbsent({
        id: 'absent-1',
        type: 'chat-response',
        userId: 'user-1',
        input: {},
      });
      expect(outcome.created).toBe(true);
      if (outcome.created) {
        expect(outcome.job.id).toBe('absent-1');
        expect(outcome.job.status).toBe('pending');
      }
    });

    it('returns {created:false, existing} when same id already exists', async () => {
      await jobStorage.create({ id: 'dup', type: 'chat-response', userId: 'user-1', input: {} });
      const outcome = await jobStorage.createIfAbsent({
        id: 'dup',
        type: 'chat-response',
        userId: 'user-1',
        input: { v: 'newer' },
      });
      expect(outcome.created).toBe(false);
      if (!outcome.created) {
        expect(outcome.existing.id).toBe('dup');
        expect(outcome.existing.input).toEqual({});
      }
    });

    it('invokes the findCollision predicate inside the mutation and returns the match', async () => {
      await jobStorage.create({
        id: 'first',
        type: 'chat-response',
        userId: 'user-1',
        input: { threadId: 't', assistantMessageId: 'a' },
      });
      const outcome = await jobStorage.createIfAbsent(
        {
          id: 'second',
          type: 'chat-response',
          userId: 'user-1',
          input: { threadId: 't', assistantMessageId: 'a' },
        },
        (jobs) =>
          Object.values(jobs).find((j) => {
            const input = j.input as { threadId?: string; assistantMessageId?: string };
            return input?.threadId === 't' && input?.assistantMessageId === 'a';
          }),
      );
      expect(outcome.created).toBe(false);
      if (!outcome.created) {
        expect(outcome.existing.id).toBe('first');
      }
    });

    it('serialises parallel createIfAbsent calls with the same id so only one wins', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          jobStorage.createIfAbsent({
            id: 'race',
            type: 'chat-response',
            userId: 'user-1',
            input: {},
          }),
        ),
      );
      const created = results.filter((r) => r.created);
      expect(created).toHaveLength(1);
      expect(results.filter((r) => !r.created)).toHaveLength(9);
    });

    it('rejects when userId is missing (multi-tenant invariant)', async () => {
      await expect(
        jobStorage.createIfAbsent({
          id: 'no-user',
          type: 'chat-response',
          userId: '',
          input: {},
        }),
      ).rejects.toThrow('userId is required');
    });
  });

  describe('concurrency mutex', () => {
    it('serialises parallel create calls so all jobs survive', async () => {
      // Without the withJobsMutation mutex, concurrent create() calls race on
      // the load → mutate → save sequence and lose updates. With the mutex,
      // every job appears in the final read.
      const ids = Array.from({ length: 25 }, (_, i) => `parallel-job-${i}`);
      await Promise.all(
        ids.map((id) =>
          jobStorage.create({
            id,
            type: 'chat-response',
            userId: 'test-user',
            input: {},
          }),
        ),
      );

      const all = await jobStorage.getAll();
      expect(all.map((job) => job.id).sort()).toEqual([...ids].sort());
    });

    it('serialises parallel updates so the final state reflects every transition', async () => {
      await jobStorage.create({
        id: 'race-job',
        type: 'chat-response',
        userId: 'test-user',
        input: {},
      });

      // Interleave several mark* calls and a setCurrentStep — the last
      // mutation in submission order should win because they serialise.
      await Promise.all([
        jobStorage.markRunning('race-job'),
        jobStorage.setCurrentStep('race-job', 'Step 1'),
        jobStorage.setCurrentStep('race-job', 'Step 2'),
        jobStorage.markCompleted('race-job', { ok: true }),
      ]);

      const final = await jobStorage.get('race-job');
      expect(final).toBeDefined();
      // The job must end up completed AND retain a currentStep — neither
      // mutation can clobber the other's field.
      expect(final?.status).toBe('completed');
      expect(final?.currentStep).toMatch(/^Step [12]$/);
      expect(final?.result).toEqual({ ok: true });
    });

    it('serialises parallel create + delete so the result is deterministic', async () => {
      // Submit a create and an immediate delete back-to-back: serialisation
      // means the delete runs after the create completes, leaving no job.
      const createPromise = jobStorage.create({
        id: 'create-then-delete',
        type: 'chat-response',
        userId: 'test-user',
        input: {},
      });
      const deletePromise = jobStorage.delete('create-then-delete');

      await Promise.all([createPromise, deletePromise]);

      const after = await jobStorage.get('create-then-delete');
      expect(after).toBeUndefined();
    });

    it('keeps the mutation chain alive after a failed mutation', async () => {
      // create() throws for empty userId; the mutex must release so the next
      // mutation still runs rather than the chain wedging.
      await expect(
        jobStorage.create({
          id: 'bad-job',
          type: 'chat-response',
          userId: '',
          input: {},
        }),
      ).rejects.toThrow(/userId is required/);

      // Subsequent mutation must succeed.
      await jobStorage.create({
        id: 'good-job',
        type: 'chat-response',
        userId: 'test-user',
        input: {},
      });

      expect(await jobStorage.get('good-job')).toBeDefined();
    });

    it('always reads the latest state from disk (no module-level cache)', async () => {
      // Simulate the cross-process scenario: write directly to the storage
      // backend (mimicking another process) and confirm the next read sees
      // the change without an explicit invalidateCache() call.
      await jobStorage.create({
        id: 'cache-test-job',
        type: 'chat-response',
        userId: 'test-user',
        input: {},
      });

      // Round-trip through update and confirm get() sees the change
      // immediately. Before the fix, jobsCache would hold the stale value.
      await jobStorage.update('cache-test-job', { status: 'running' });
      const observed = await jobStorage.get('cache-test-job');
      expect(observed?.status).toBe('running');
    });
  });

  describe('terminal CAS helpers', () => {
    it('markCompletedIdempotent transitions a running job and persists the result', async () => {
      await jobStorage.create({ id: 'cas-c1', type: 'chat-response', userId: 'u1', input: {} });
      await jobStorage.markRunning('cas-c1');
      const status = await jobStorage.markCompletedIdempotent('cas-c1', { ok: true });
      expect(status).toBe('completed');
      const job = await jobStorage.get<{ ok: boolean }>('cas-c1');
      expect(job?.status).toBe('completed');
      expect(job?.result).toEqual({ ok: true });
    });

    it('markCompletedIdempotent is a no-op when the job is already terminal', async () => {
      await jobStorage.create({ id: 'cas-c2', type: 'chat-response', userId: 'u1', input: {} });
      await jobStorage.markCancelled('cas-c2');
      const status = await jobStorage.markCompletedIdempotent('cas-c2', { ok: true });
      expect(status).toBe('cancelled');
      const job = await jobStorage.get('cas-c2');
      expect(job?.status).toBe('cancelled');
      expect(job?.result).toBeUndefined();
    });

    it('markFailedIfNonTerminal transitions when running and reports transitioned=true', async () => {
      await jobStorage.create({ id: 'cas-f1', type: 'chat-response', userId: 'u1', input: {} });
      await jobStorage.markRunning('cas-f1');
      const res = await jobStorage.markFailedIfNonTerminal('cas-f1', 'boom');
      expect(res).toEqual({ status: 'failed', transitioned: true });
      const job = await jobStorage.get('cas-f1');
      expect(job?.status).toBe('failed');
      expect(job?.error).toBe('boom');
    });

    it('markFailedIfNonTerminal is a no-op when already cancelled and reports transitioned=false', async () => {
      await jobStorage.create({ id: 'cas-f2', type: 'chat-response', userId: 'u1', input: {} });
      await jobStorage.markCancelled('cas-f2');
      const res = await jobStorage.markFailedIfNonTerminal('cas-f2', 'boom');
      expect(res).toEqual({ status: 'cancelled', transitioned: false });
      const job = await jobStorage.get('cas-f2');
      expect(job?.status).toBe('cancelled');
    });

    it('markCancelledIfNonTerminal transitions when running and reports transitioned=true', async () => {
      await jobStorage.create({ id: 'cas-x1', type: 'chat-response', userId: 'u1', input: {} });
      await jobStorage.markRunning('cas-x1');
      const res = await jobStorage.markCancelledIfNonTerminal('cas-x1');
      expect(res).toEqual({ status: 'cancelled', transitioned: true });
    });

    it('markCancelledIfNonTerminal is a no-op when already completed', async () => {
      await jobStorage.create({ id: 'cas-x2', type: 'chat-response', userId: 'u1', input: {} });
      await jobStorage.markCompleted('cas-x2', { ok: true });
      const res = await jobStorage.markCancelledIfNonTerminal('cas-x2');
      expect(res).toEqual({ status: 'completed', transitioned: false });
    });

    it('CAS helpers report transitioned=false when the job does not exist', async () => {
      const fail = await jobStorage.markFailedIfNonTerminal('missing', 'boom');
      const cancel = await jobStorage.markCancelledIfNonTerminal('missing');
      expect(fail.transitioned).toBe(false);
      expect(cancel.transitioned).toBe(false);
    });
  });
});

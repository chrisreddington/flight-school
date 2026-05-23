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
});

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
      input: {},
    });
    await jobStorage.create({
      id: 'job-pending',
      type: 'chat-response',
      input: {},
    });
    await jobStorage.create({
      id: 'job-completed',
      type: 'chat-response',
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
      input: {},
    });

    const updated = await jobStorage.markFailed('job-to-fail', 'Server process restarted');

    expect(updated).toBeDefined();
    expect(updated?.status).toBe('failed');
    expect(updated?.error).toBe('Server process restarted');
    expect(updated?.completedAt).toBeTruthy();
  });
});

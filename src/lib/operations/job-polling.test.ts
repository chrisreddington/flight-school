import { describe, expect, it } from 'vitest';

import { getJobPollingDecision } from './job-polling';

describe('job polling decisions', () => {
  it.each([
    { status: 'completed' as const, expected: { kind: 'completed' as const } },
    { status: 'cancelled' as const, expected: { kind: 'cancelled' as const } },
    { status: 'failed' as const, expected: { kind: 'failed' as const, error: 'Nope' } },
  ])('should stop polling when job status is $status', ({ status, expected }) => {
    expect(
      getJobPollingDecision({
        job: { id: 'job-1', type: 'topic-regeneration', status, error: 'Nope' },
        elapsedMs: 0,
        timeoutMs: 120_000,
      }),
    ).toEqual(expected);
  });

  it('should stop polling as failed when the job is missing', () => {
    expect(
      getJobPollingDecision({
        job: null,
        elapsedMs: 0,
        timeoutMs: 120_000,
      }),
    ).toEqual({ kind: 'missing', error: 'Job not found' });
  });

  it('should stop polling as timed out after the current max poll duration is exceeded', () => {
    expect(
      getJobPollingDecision({
        job: { id: 'job-1', type: 'topic-regeneration', status: 'running' },
        elapsedMs: 120_001,
        timeoutMs: 120_000,
      }),
    ).toEqual({ kind: 'timed-out', error: 'Operation timed out' });
  });

  it.each(['pending', 'running'] as const)('should continue polling when job status is %s', (status) => {
    expect(
      getJobPollingDecision({
        job: { id: 'job-1', type: 'topic-regeneration', status },
        elapsedMs: 1_000,
        timeoutMs: 120_000,
      }),
    ).toEqual({ kind: 'continue' });
  });
});

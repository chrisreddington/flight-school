import { describe, expect, it, vi } from 'vitest';
import {
  getRegisteredSession,
  requestCancellation,
  registerSession,
  unregisterSession,
} from './session-registry';

describe('job executor session registry', () => {
  it('returns a registered session until it is unregistered', () => {
    const session = { destroy: vi.fn(async () => undefined) };

    registerSession('job-1', session);

    expect(getRegisteredSession('job-1')).toBe(session);

    unregisterSession('job-1');

    expect(getRegisteredSession('job-1')).toBeUndefined();
  });

  it('destroys immediately when cancellation is requested before registration', async () => {
    const session = { destroy: vi.fn(async () => undefined) };

    expect(await requestCancellation('job-2')).toBe(false);
    registerSession('job-2', session);

    expect(session.destroy).toHaveBeenCalledTimes(1);
    expect(getRegisteredSession('job-2')).toBeUndefined();
  });
});

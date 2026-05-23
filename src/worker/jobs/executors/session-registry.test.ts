import { describe, expect, it, vi } from 'vitest';
import {
  getRegisteredSession,
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
});

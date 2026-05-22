import { describe, expect, it } from 'vitest';
import { getCopilotRuntimeConfig } from './config';

describe('getCopilotRuntimeConfig', () => {
  it('uses conservative defaults', () => {
    expect(getCopilotRuntimeConfig({}, '/tmp/flight-school')).toEqual({
      idleTtlMs: 600_000,
      maxActiveRuntimes: 3,
      homeRoot: '/tmp/flight-school/copilot-runtimes',
    });
  });

  it('reads env overrides', () => {
    expect(getCopilotRuntimeConfig({
      COPILOT_RUNTIME_IDLE_TTL_MS: '30000',
      COPILOT_RUNTIME_MAX_ACTIVE: '2',
      COPILOT_RUNTIME_HOME_ROOT: '/tmp/custom-runtimes',
    }, '/tmp/flight-school')).toEqual({
      idleTtlMs: 30_000,
      maxActiveRuntimes: 2,
      homeRoot: '/tmp/custom-runtimes',
    });
  });

  it('rejects invalid max active runtimes', () => {
    expect(() => getCopilotRuntimeConfig({ COPILOT_RUNTIME_MAX_ACTIVE: '0' }, '/tmp/root'))
      .toThrow('COPILOT_RUNTIME_MAX_ACTIVE must be a positive integer');
  });
});

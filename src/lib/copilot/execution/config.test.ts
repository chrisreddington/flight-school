import { describe, expect, it } from 'vitest';
import { getCopilotWorkerConfig } from './config';

describe('getCopilotWorkerConfig', () => {
  it('returns null when no worker URL is configured', () => {
    expect(getCopilotWorkerConfig({})).toBeNull();
  });

  it('requires a worker secret when worker URL is configured', () => {
    expect(() => getCopilotWorkerConfig({ COPILOT_WORKER_URL: 'http://localhost:3001' })).toThrow(
      'COPILOT_WORKER_SECRET is required when COPILOT_WORKER_URL is set',
    );
  });

  it('normalizes trailing slashes from the worker URL', () => {
    expect(
      getCopilotWorkerConfig({
        COPILOT_WORKER_URL: 'http://localhost:3001/',
        COPILOT_WORKER_SECRET: 'local-secret',
        COPILOT_WORKER_TIMEOUT_MS: '45000',
      }),
    ).toEqual({ baseUrl: 'http://localhost:3001', secret: 'local-secret', timeoutMs: 45000 });
  });

  it('rejects non-positive worker timeouts', () => {
    expect(() =>
      getCopilotWorkerConfig({
        COPILOT_WORKER_URL: 'http://localhost:3001',
        COPILOT_WORKER_SECRET: 'local-secret',
        COPILOT_WORKER_TIMEOUT_MS: '0',
      }),
    ).toThrow('COPILOT_WORKER_TIMEOUT_MS must be a positive integer');
  });
});

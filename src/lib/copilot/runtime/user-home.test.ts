import { describe, expect, it } from 'vitest';
import { getCopilotRuntimeHome } from './user-home';

describe('getCopilotRuntimeHome', () => {
  it('builds a safe per-user home path', () => {
    expect(getCopilotRuntimeHome('/tmp/runtimes', '123')).toBe('/tmp/runtimes/123');
  });

  it('rejects path traversal user IDs', () => {
    expect(() => getCopilotRuntimeHome('/tmp/runtimes', '../123'))
      .toThrow('Refusing unsafe userId for runtime path');
  });
});

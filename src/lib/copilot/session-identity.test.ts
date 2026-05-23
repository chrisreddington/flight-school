import { describe, expect, it } from 'vitest';
import { createSessionIdentity } from './session-identity';

describe('createSessionIdentity', () => {
  it('should map request user context to a per-session GitHub identity', () => {
    expect(createSessionIdentity({ userId: 'u1', accessToken: 'ghu_1' })).toEqual({
      userId: 'u1',
      gitHubToken: 'ghu_1',
    });
  });
});

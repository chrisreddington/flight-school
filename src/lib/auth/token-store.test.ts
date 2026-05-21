import { describe, expect, it } from 'vitest';

import { InMemoryTokenStore } from './token-store';

describe('InMemoryTokenStore', () => {
  it('returns null for unknown users', async () => {
    const store = new InMemoryTokenStore();
    await expect(store.getToken('nobody')).resolves.toBeNull();
  });

  it('round-trips a token', async () => {
    const store = new InMemoryTokenStore();
    const future = Math.floor(Date.now() / 1000) + 3600;
    await store.setToken('u1', { accessToken: 'ghu_x', expiresAt: future });
    await expect(store.getToken('u1')).resolves.toEqual({
      accessToken: 'ghu_x',
      expiresAt: future,
    });
  });

  it('treats expired tokens as missing', async () => {
    const store = new InMemoryTokenStore();
    await store.setToken('u1', { accessToken: 'ghu_x', expiresAt: 1 });
    await expect(store.getToken('u1')).resolves.toBeNull();
  });

  it('deletes tokens', async () => {
    const store = new InMemoryTokenStore();
    await store.setToken('u1', { accessToken: 'ghu_x', expiresAt: Math.floor(Date.now() / 1000) + 60 });
    await store.deleteToken('u1');
    await expect(store.getToken('u1')).resolves.toBeNull();
  });
});

import type { StoredToken, TokenStore } from './types';

/**
 * In-memory token store for local development and testing.
 * State is per-process and lost on restart.
 */
export class InMemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, StoredToken>();

  async getToken(userId: string): Promise<StoredToken | null> {
    return this.tokens.get(userId) ?? null;
  }

  async setToken(userId: string, token: StoredToken): Promise<void> {
    this.tokens.set(userId, token);
  }

  async setTokenIfNewer(userId: string, token: StoredToken): Promise<boolean> {
    const existing = this.tokens.get(userId);
    if (existing && existing.expiresAt >= token.expiresAt) {
      return false;
    }
    this.tokens.set(userId, token);
    return true;
  }

  async deleteToken(userId: string): Promise<void> {
    this.tokens.delete(userId);
  }

  async cleanupExpired(): Promise<number> {
    return 0;
  }
}

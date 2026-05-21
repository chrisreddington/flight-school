/**
 * Token Store Abstraction
 *
 * Provides a pluggable interface for persisting GitHub user-to-server (`ghu_`)
 * tokens outside the JWT cookie. For the MVP the encrypted JWT cookie holds
 * the token directly, so the in-memory implementation is enough; the Cosmos
 * implementation is a placeholder for when we move tokens off the cookie.
 */

import { nowMs } from '@/lib/utils/date-utils';

export interface StoredToken {
  /** The GitHub user-to-server access token (`ghu_...`). */
  accessToken: string;
  /** Optional refresh token (`ghr_...`). */
  refreshToken?: string;
  /** Unix timestamp (seconds) when the access token expires. */
  expiresAt: number;
}

export interface TokenStore {
  getToken(userId: string): Promise<StoredToken | null>;
  setToken(userId: string, token: StoredToken): Promise<void>;
  deleteToken(userId: string): Promise<void>;
}

/**
 * In-memory token store for local development and testing.
 * State is per-process and lost on restart.
 */
export class InMemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, StoredToken>();

  async getToken(userId: string): Promise<StoredToken | null> {
    const token = this.tokens.get(userId);
    if (!token) return null;
    // Treat already-expired tokens as missing so callers refresh.
    if (token.expiresAt > 0 && token.expiresAt * 1000 <= nowMs()) {
      return null;
    }
    return token;
  }

  async setToken(userId: string, token: StoredToken): Promise<void> {
    this.tokens.set(userId, token);
  }

  async deleteToken(userId: string): Promise<void> {
    this.tokens.delete(userId);
  }
}

/**
 * Cosmos DB-backed token store. NOT YET IMPLEMENTED.
 *
 * TODO: Wire to Azure Cosmos DB once the infra in `infra/` is provisioned.
 * The interface is intentionally identical to `InMemoryTokenStore` so
 * callers can swap implementations without changes.
 */
export class CosmosTokenStore implements TokenStore {
  async getToken(_userId: string): Promise<StoredToken | null> {
    void _userId;
    throw new Error('CosmosTokenStore is not implemented yet. Use InMemoryTokenStore for local dev.');
  }

  async setToken(_userId: string, _token: StoredToken): Promise<void> {
    void _userId;
    void _token;
    throw new Error('CosmosTokenStore is not implemented yet.');
  }

  async deleteToken(_userId: string): Promise<void> {
    void _userId;
    throw new Error('CosmosTokenStore is not implemented yet.');
  }
}

let defaultStore: TokenStore | null = null;

/**
 * Returns the process-wide default token store. For MVP this is always
 * the in-memory implementation; tests can override via `setTokenStore`.
 */
export function getTokenStore(): TokenStore {
  if (!defaultStore) {
    defaultStore = new InMemoryTokenStore();
  }
  return defaultStore;
}

/** Test-only override for the default token store. */
export function setTokenStore(store: TokenStore | null): void {
  defaultStore = store;
}

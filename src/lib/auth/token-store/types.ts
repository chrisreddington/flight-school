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
  setTokenIfNewer(userId: string, token: StoredToken): Promise<boolean>;
  deleteToken(userId: string): Promise<void>;
  cleanupExpired(): Promise<number>;
}

/**
 * Token Store Abstraction
 *
 * Provides a pluggable interface for persisting GitHub user-to-server (`ghu_`)
 * tokens outside the JWT cookie.
 *
 * Two implementations:
 *
 * - {@link InMemoryTokenStore}: process-local Map. Fine for local development
 *   and tests. A server restart drops all sessions, which is the secure-by-
 *   default behaviour (no plaintext tokens leak to disk).
 * - {@link CosmosTokenStore}: Azure Cosmos DB-backed, with envelope
 *   encryption. The token payload is encrypted with a per-record AES-256-GCM
 *   data encryption key (DEK), and the DEK is wrapped with an Azure Key Vault
 *   key (KEK) using `wrapKey`/`unwrapKey`. All Azure clients authenticate via
 *   `DefaultAzureCredential` — no static secrets in env.
 *
 * The {@link TokenStore} contract is the Liskov boundary: callers MUST be able
 * to swap implementations without behavioural change.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { CryptographyClient, KnownEncryptionAlgorithms } from '@azure/keyvault-keys';
import { CosmosClient, type Container } from '@azure/cosmos';
import { DefaultAzureCredential, type TokenCredential } from '@azure/identity';

import { logger } from '@/lib/logger';
import { nowMs } from '@/lib/utils/date-utils';

const log = logger.withTag('TokenStore');

/** AEAD algorithm used for the token payload. */
const AEAD_ALG = 'aes-256-gcm';
/** GCM standard IV length (96 bits). */
const IV_LENGTH = 12;
/** AES-256 key length (256 bits). */
const DEK_LENGTH = 32;
/** GCM auth tag length (128 bits). */
const AUTH_TAG_LENGTH = 16;
/** Composite algorithm label persisted alongside ciphertext. */
const ENVELOPE_ALG = 'AES-256-GCM/A256KW';
/** Key Vault key-wrap algorithm. */
const KEY_WRAP_ALG = KnownEncryptionAlgorithms.A256KW;

export interface StoredToken {
  /** The GitHub user-to-server access token (`ghu_...`). */
  accessToken: string;
  /** Optional refresh token (`ghr_...`). */
  refreshToken?: string;
  /** Unix timestamp (seconds) when the access token expires. */
  expiresAt: number;
}

export interface TokenStore {
  /**
   * Look up the stored token for `userId`.
   *
   * @param userId - Stable GitHub numeric ID as a string.
   * @returns The {@link StoredToken}, or `null` when no record exists for
   *   the user **or** when the stored record has already expired
   *   (`expiresAt * 1000 <= now`). Callers must treat "not found" and
   *   "expired" identically — both mean "refresh / re-auth required".
   *   Never throws for missing users.
   */
  getToken(userId: string): Promise<StoredToken | null>;
  /**
   * Persist `token` for `userId`.
   *
   * @param userId - Stable GitHub numeric ID as a string.
   * @param token - The token payload to store. Overwrites (upserts) any
   *   previous record for the same `userId`; there is no separate update
   *   path. TTL semantics live on the record itself via
   *   {@link StoredToken.expiresAt}; implementations do not enforce a
   *   separate store-level TTL.
   */
  setToken(userId: string, token: StoredToken): Promise<void>;
  /**
   * Remove the token record for `userId`.
   *
   * @param userId - Stable GitHub numeric ID as a string.
   * @remarks Idempotent: deleting a `userId` with no stored token is a
   *   successful no-op, not an error.
   */
  deleteToken(userId: string): Promise<void>;
  /**
   * Best-effort sweep of expired records. Implementations that do not retain
   * expired records may no-op.
   *
   * @returns The number of records removed during this sweep.
   */
  cleanupExpired(): Promise<number>;
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
    if (this.isExpired(token)) {
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

  async cleanupExpired(): Promise<number> {
    let removed = 0;
    for (const [userId, token] of this.tokens) {
      if (this.isExpired(token)) {
        this.tokens.delete(userId);
        removed += 1;
      }
    }
    return removed;
  }

  private isExpired(token: StoredToken): boolean {
    return token.expiresAt > 0 && token.expiresAt * 1000 <= nowMs();
  }
}

/** Configuration for {@link CosmosTokenStore}. */
export interface CosmosTokenStoreConfig {
  cosmosEndpoint: string;
  databaseId: string;
  containerId: string;
  keyVaultUrl: string;
  keyName: string;
  /** Optional explicit key version; default = latest. */
  keyVersion?: string;
  /** Override credential (tests). Defaults to `DefaultAzureCredential`. */
  credential?: TokenCredential;
  /** Override Cosmos container (tests). */
  container?: Container;
  /** Override CryptographyClient (tests). */
  cryptographyClient?: CryptographyClient;
}

/** Shape of the persisted Cosmos document. */
interface TokenDocument {
  id: string;
  userId: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  wrappedDek: string;
  kekId: string;
  alg: typeof ENVELOPE_ALG;
  createdAt: number;
  /** Unix seconds; mirrors {@link StoredToken.expiresAt}. */
  expiresAt: number;
}

/**
 * Read Cosmos store configuration from environment variables. Returns `null`
 * if the required vars are missing.
 */
export function readCosmosConfigFromEnv(): CosmosTokenStoreConfig | null {
  const cosmosEndpoint = process.env.AZURE_COSMOS_ENDPOINT;
  const databaseId = process.env.AZURE_COSMOS_DATABASE;
  const containerId = process.env.AZURE_COSMOS_CONTAINER;
  const keyVaultUrl = process.env.AZURE_KEY_VAULT_URL;
  const keyName = process.env.AZURE_KEY_VAULT_KEY_NAME;
  const keyVersion = process.env.AZURE_KEY_VAULT_KEY_VERSION;

  if (!cosmosEndpoint) return null;
  if (!databaseId || !containerId || !keyVaultUrl || !keyName) {
    throw new Error(
      'AZURE_COSMOS_ENDPOINT is set but one of AZURE_COSMOS_DATABASE / AZURE_COSMOS_CONTAINER / AZURE_KEY_VAULT_URL / AZURE_KEY_VAULT_KEY_NAME is missing.',
    );
  }
  return { cosmosEndpoint, databaseId, containerId, keyVaultUrl, keyName, keyVersion };
}

/**
 * Cosmos DB-backed token store with envelope encryption.
 *
 * - Payload encrypted with a fresh AES-256-GCM DEK per record (12-byte IV).
 * - DEK wrapped with Azure Key Vault KEK via `wrapKey(A256KW)`.
 * - Documents are partitioned by `userId`; reads are filtered by `userId`
 *   so a hostile or buggy caller cannot decrypt another user's row.
 *
 * Liskov: behaviourally identical to {@link InMemoryTokenStore} for callers —
 * unknown users return `null`, expired tokens return `null`.
 */
export class CosmosTokenStore implements TokenStore {
  private readonly container: Container;
  private readonly cryptographyClient: CryptographyClient;
  private readonly kekId: string;

  constructor(config: CosmosTokenStoreConfig) {
    const credential = config.credential ?? new DefaultAzureCredential();

    if (config.container) {
      this.container = config.container;
    } else {
      const client = new CosmosClient({ endpoint: config.cosmosEndpoint, aadCredentials: credential });
      this.container = client.database(config.databaseId).container(config.containerId);
    }

    const keyIdentifier = config.keyVersion
      ? `${config.keyVaultUrl.replace(/\/$/, '')}/keys/${config.keyName}/${config.keyVersion}`
      : `${config.keyVaultUrl.replace(/\/$/, '')}/keys/${config.keyName}`;
    this.kekId = keyIdentifier;
    this.cryptographyClient = config.cryptographyClient ?? new CryptographyClient(keyIdentifier, credential);
  }

  /**
   * {@inheritDoc TokenStore.getToken}
   *
   * @remarks
   * Cosmos point-read by `(userId, userId)` partition key. The wrapped DEK
   * is unwrapped via Azure Key Vault `unwrapKey(A256KW)` and the payload is
   * decrypted in-process with AES-256-GCM. The DEK buffer is zeroed before
   * the method returns. Returns `null` on 404, on a mismatched `userId` in
   * the persisted document (defence-in-depth), and on expiry.
   */
  async getToken(userId: string): Promise<StoredToken | null> {
    let doc: TokenDocument | undefined;
    try {
      const response = await this.container.item(userId, userId).read<TokenDocument>();
      doc = response.resource;
    } catch (error) {
      const status = (error as { code?: number; statusCode?: number }).code ?? (error as { statusCode?: number }).statusCode;
      if (status === 404) return null;
      throw error;
    }
    if (!doc) return null;

    // Defence-in-depth: verify the document we got back is for the user we
    // asked about. Cosmos enforces partition isolation, but never decrypt
    // someone else's row if the read returns one for any reason.
    if (doc.userId !== userId) {
      log.warn('Refusing to decrypt token document with mismatched userId', {
        requested: userId,
        actual: doc.userId,
      });
      return null;
    }

    if (doc.expiresAt > 0 && doc.expiresAt * 1000 <= nowMs()) {
      return null;
    }

    const wrappedDek = Buffer.from(doc.wrappedDek, 'base64');
    const iv = Buffer.from(doc.iv, 'base64');
    const authTag = Buffer.from(doc.authTag, 'base64');
    const ciphertext = Buffer.from(doc.ciphertext, 'base64');

    const unwrap = await this.cryptographyClient.unwrapKey(KEY_WRAP_ALG, wrappedDek);
    const dek = Buffer.from(unwrap.result);
    try {
      const decipher = createDecipheriv(AEAD_ALG, dek, iv);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const parsed = JSON.parse(plaintext.toString('utf8')) as StoredToken;
      return parsed;
    } finally {
      dek.fill(0);
    }
  }

  /**
   * {@inheritDoc TokenStore.setToken}
   *
   * @remarks
   * Encrypts the JSON-serialised token with a freshly generated AES-256-GCM
   * data encryption key (DEK), wraps the DEK with the configured Azure Key
   * Vault KEK (`wrapKey(A256KW)`), and upserts the envelope as a single
   * Cosmos document partitioned by `userId`. The DEK is zeroed in `finally`.
   */
  async setToken(userId: string, token: StoredToken): Promise<void> {
    const dek = randomBytes(DEK_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    try {
      const cipher = createCipheriv(AEAD_ALG, dek, iv, { authTagLength: AUTH_TAG_LENGTH });
      const plaintext = Buffer.from(JSON.stringify(token), 'utf8');
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const wrap = await this.cryptographyClient.wrapKey(KEY_WRAP_ALG, dek);
      const wrappedDek = Buffer.from(wrap.result);

      const doc: TokenDocument = {
        id: userId,
        userId,
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        wrappedDek: wrappedDek.toString('base64'),
        kekId: this.kekId,
        alg: ENVELOPE_ALG,
        createdAt: Math.floor(nowMs() / 1000),
        expiresAt: token.expiresAt,
      };
      await this.container.items.upsert(doc, { disableAutomaticIdGeneration: true });
    } finally {
      dek.fill(0);
    }
  }

  async deleteToken(userId: string): Promise<void> {
    try {
      await this.container.item(userId, userId).delete();
    } catch (error) {
      const status = (error as { code?: number; statusCode?: number }).code ?? (error as { statusCode?: number }).statusCode;
      if (status === 404) return;
      throw error;
    }
  }

  async cleanupExpired(): Promise<number> {
    const nowSec = Math.floor(nowMs() / 1000);
    const iterator = this.container.items.query<{ id: string; userId: string }>({
      query: 'SELECT c.id, c.userId FROM c WHERE c.expiresAt > 0 AND c.expiresAt <= @now',
      parameters: [{ name: '@now', value: nowSec }],
    });

    let removed = 0;
    while (iterator.hasMoreResults()) {
      const page = await iterator.fetchNext();
      for (const row of page.resources ?? []) {
        try {
          await this.container.item(row.id, row.userId).delete();
          removed += 1;
        } catch (error) {
          const status = (error as { code?: number; statusCode?: number }).code ?? (error as { statusCode?: number }).statusCode;
          if (status === 404) continue;
          log.warn('Failed to delete expired token document', { userId: row.userId, error });
        }
      }
    }
    return removed;
  }
}

let defaultStore: TokenStore | null = null;

/**
 * Returns the process-wide default token store. The implementation is chosen
 * by {@link createDefaultTokenStore} in `./token-store-factory.ts`.
 *
 * This function lazily initialises via the factory to avoid an import cycle.
 */
export function getTokenStore(): TokenStore {
  if (!defaultStore) {
    // Lazy require avoids a circular import between this module and the
    // factory (factory imports `InMemoryTokenStore`/`CosmosTokenStore`).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const factory = require('./token-store-factory') as typeof import('./token-store-factory');
    defaultStore = factory.createDefaultTokenStore();
  }
  return defaultStore;
}

/** Test-only override for the default token store. */
export function setTokenStore(store: TokenStore | null): void {
  defaultStore = store;
}

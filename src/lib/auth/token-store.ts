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

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

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

/**
 * Default ceiling on the number of unwrapped DEKs the CosmosTokenStore
 * keeps in memory at any one time. Sized for typical concurrent-user
 * counts in a single replica; configurable per-instance.
 */
const DEK_CACHE_MAX_ENTRIES = 256;

/**
 * Default TTL (ms) for a cached unwrapped DEK. Capped well below the
 * GitHub access-token lifetime (~8h) so that revocation or a sign-out
 * is naturally honoured within a short window without an explicit
 * purge — the next decrypt will go to Key Vault and observe whatever
 * the persisted document now says.
 */
const DEK_CACHE_DEFAULT_TTL_MS = 15 * 60 * 1000;

interface StatusCodeError {
  code?: number;
  statusCode?: number;
}

function getStatusCode(error: unknown): number | undefined {
  const typed = error as StatusCodeError;
  return typed.code ?? typed.statusCode;
}

interface CachedDek {
  /** Digest of (kekId || wrappedDekBase64). Guards against using a stale DEK against a re-wrapped envelope. */
  envelopeDigest: string;
  /** The unwrapped DEK bytes. Lives only in this cache and the in-flight decipher. */
  dek: Buffer;
  /** Wall-clock ms at which this entry must be re-fetched from Key Vault. */
  expiresAtMs: number;
}

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
   *   the user. **Returns expired records as well** — the access token in
   *   the record may already be past `expiresAt`, but the accompanying
   *   refresh token is typically still valid (GitHub refresh tokens last
   *   6 months vs the 8h access token). Filtering expired records here
   *   would prevent {@link resolveFreshGitHubToken} from doing its job
   *   (refresh at execution time). Callers are responsible for checking
   *   `expiresAt` and exchanging the refresh token via
   *   {@link refreshGitHubAccessToken} as needed. Never throws for
   *   missing users.
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
   * Persist `token` for `userId` **only if** it is strictly newer than the
   * record currently stored (compared by `expiresAt`). This is the CAS-style
   * write used by callers that may race with other writers — e.g. two ACA
   * replicas concurrently refreshing the same user's access token. Without
   * this guard, an older response can clobber a newer record after the
   * winner has already rotated GitHub's refresh token.
   *
   * @param userId - Stable GitHub numeric ID as a string.
   * @param token - The candidate token payload.
   * @returns `true` if `token` was written; `false` if a record with an
   *   `expiresAt >= token.expiresAt` was already present, or if a concurrent
   *   writer won the CAS exchange (HTTP 412 / 409 from Cosmos). Never
   *   throws on the lost-CAS path — callers can treat `false` as "someone
   *   else already persisted at least this freshness" and move on.
   */
  setTokenIfNewer(userId: string, token: StoredToken): Promise<boolean>;
  /**
   * Remove the token record for `userId`.
   *
   * @param userId - Stable GitHub numeric ID as a string.
   * @remarks Idempotent: deleting a `userId` with no stored token is a
   *   successful no-op, not an error.
   */
  deleteToken(userId: string): Promise<void>;
  /**
   * Best-effort sweep of stale records.
   *
   * @returns The number of records removed during this sweep.
   *
   * @remarks
   * Currently a no-op. Sweeping by access-token expiry would delete
   * records whose refresh tokens are still valid for months, which would
   * break re-auth-less recovery. A proper sweep needs the refresh-token
   * expiry to be persisted (GitHub returns `refresh_token_expires_in` on
   * the OAuth callback; we don't yet plumb it through). Until then the
   * only deletion path is explicit sign-out via {@link deleteToken}.
   * Records are bounded per user (one row per user), so growth scales
   * with user count, not request count.
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
    // Return refreshable records as well; the caller decides whether the
    // access token is fresh enough or whether to refresh. See the
    // TokenStore.getToken contract for the rationale.
    return this.tokens.get(userId) ?? null;
  }

  async setToken(userId: string, token: StoredToken): Promise<void> {
    this.tokens.set(userId, token);
  }

  /**
   * {@inheritDoc TokenStore.setTokenIfNewer}
   *
   * @remarks
   * Node's event loop gives us cooperative concurrency: between the read
   * and the write below, no other JavaScript runs on this isolate, so the
   * compare-then-set is atomic in-process. Across processes the in-memory
   * store offers no isolation (it's a per-process Map), but the in-memory
   * store is never used in multi-replica deployments.
   */
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

  /**
   * {@inheritDoc TokenStore.cleanupExpired}
   */
  async cleanupExpired(): Promise<number> {
    return 0;
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
  /**
   * Max entries to keep in the unwrapped-DEK cache.
   * Defaults to {@link DEK_CACHE_MAX_ENTRIES}. Set to `0` to disable the
   * cache entirely (every `getToken` will round-trip to Key Vault).
   */
  dekCacheMaxEntries?: number;
  /**
   * TTL (ms) for each unwrapped-DEK cache entry.
   * Defaults to {@link DEK_CACHE_DEFAULT_TTL_MS}.
   */
  dekCacheTtlMs?: number;
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
 * Build the canonical Additional Authenticated Data (AAD) for an AES-GCM
 * envelope. Emits a JSON object with **deterministic lexicographic key
 * order** — any reorder, rename, add, or remove silently invalidates every
 * previously-written ciphertext. See {@link CosmosTokenStore} for the
 * security rationale and migration constraints.
 */
function buildAAD(parts: {
  userId: string;
  alg: typeof ENVELOPE_ALG;
  kekId: string;
  expiresAt: number;
}): Buffer {
  const canonical = {
    alg: parts.alg,
    expiresAt: parts.expiresAt,
    kekId: parts.kekId,
    userId: parts.userId,
  };
  return Buffer.from(JSON.stringify(canonical), 'utf8');
}

/**
 * Read Cosmos store configuration from environment variables. Returns `null`
 * when `AZURE_COSMOS_ENDPOINT` is unset (signal to fall back to the in-memory
 * store).
 *
 * @throws {Error} when `AZURE_COSMOS_ENDPOINT` is set but any of the required
 *   Cosmos / Key Vault env vars (`AZURE_COSMOS_DATABASE`,
 *   `AZURE_COSMOS_CONTAINER`, `AZURE_KEY_VAULT_URL`, `AZURE_KEY_VAULT_KEY_NAME`)
 *   are missing.
 */
function readCosmosConfigFromEnv(): CosmosTokenStoreConfig | null {
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
 *
 * @remarks
 * **AAD invariant (do not change without a versioned migration).** Every
 * record's AES-GCM Additional Authenticated Data is built by `buildAAD` as
 * a UTF-8 JSON object with lexicographic key order:
 *
 * ```json
 * {"alg":"AES-256-GCM/A256KW","expiresAt":<n>,"kekId":"<url>","userId":"<id>"}
 * ```
 *
 * The AAD binds the ciphertext to its encryption context so a writer (or
 * attacker) cannot graft one user's `ciphertext + iv + authTag + wrappedDek`
 * into another user's document and have it decrypt — AES-GCM checks AAD
 * byte-for-byte at `decipher.final()`. Tampering with `expiresAt` / `kekId`
 * / `userId` / `alg` on a persisted document therefore causes decryption to
 * throw. Reordering, renaming, adding, or removing AAD fields silently
 * invalidates **every** previously-written ciphertext; bump a version field
 * and migrate if you must change the shape.
 */
export class CosmosTokenStore implements TokenStore {
  private readonly container: Container;
  private readonly cryptographyClient: CryptographyClient;
  private readonly kekId: string;
  /**
   * Bounded LRU+TTL cache of unwrapped DEKs, keyed by `userId`. Eliminates
   * a Key Vault `unwrapKey` round-trip on the hot getToken path while
   * keeping the blast radius small: entries are size-bounded, TTL-bounded,
   * invalidated on every write for the same user, and verified against the
   * envelope digest before reuse so a rotated record can never be
   * decrypted with a stale DEK.
   *
   * LRU is implemented via Map insertion order (re-inserted on each hit).
   */
  private readonly dekCache: Map<string, CachedDek>;
  private readonly dekCacheMaxEntries: number;
  private readonly dekCacheTtlMs: number;

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

    this.dekCacheMaxEntries = config.dekCacheMaxEntries ?? DEK_CACHE_MAX_ENTRIES;
    this.dekCacheTtlMs = config.dekCacheTtlMs ?? DEK_CACHE_DEFAULT_TTL_MS;
    this.dekCache = new Map();
  }

  /**
   * Compute the cache-validation digest for an envelope. Binds the cached
   * DEK to the exact `(kekId, wrappedDek)` pair so that a record rewritten
   * with a fresh DEK invalidates an in-memory cache entry on the very next
   * lookup — no chance of decrypting new ciphertext with an old key.
   */
  private envelopeDigest(kekId: string, wrappedDekBase64: string): string {
    return createHash('sha256').update(`${kekId}|${wrappedDekBase64}`).digest('base64');
  }

  /**
   * Return a cached unwrapped DEK for `userId` if and only if it has not
   * expired and the envelope on the current record still matches. Touches
   * insertion order on a hit so the entry survives the next LRU eviction.
   */
  private getCachedDek(userId: string, expectedDigest: string): Buffer | null {
    const entry = this.dekCache.get(userId);
    if (!entry) return null;
    if (entry.expiresAtMs <= nowMs()) {
      this.dekCache.delete(userId);
      entry.dek.fill(0);
      return null;
    }
    if (entry.envelopeDigest !== expectedDigest) {
      // Record was rewritten with a fresh DEK; the cached one is for a
      // previous envelope and must not be reused.
      this.dekCache.delete(userId);
      entry.dek.fill(0);
      return null;
    }
    // Re-insert to move to most-recently-used position.
    this.dekCache.delete(userId);
    this.dekCache.set(userId, entry);
    return entry.dek;
  }

  /**
   * Store an unwrapped DEK in the cache, evicting the oldest entry when
   * the size cap would be exceeded. The cached buffer is the same reference
   * the in-flight decipher uses; we deliberately do NOT zero it on store
   * because the cache is its current owner. It is zeroed on eviction,
   * invalidation, or TTL expiry.
   */
  private putCachedDek(userId: string, envelopeDigest: string, dek: Buffer): void {
    if (this.dekCacheMaxEntries <= 0) return;
    // Replace any existing entry first (and zero its DEK).
    const existing = this.dekCache.get(userId);
    if (existing) {
      existing.dek.fill(0);
      this.dekCache.delete(userId);
    }
    while (this.dekCache.size >= this.dekCacheMaxEntries) {
      const oldestKey = this.dekCache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.dekCache.get(oldestKey);
      this.dekCache.delete(oldestKey);
      if (oldest) oldest.dek.fill(0);
    }
    this.dekCache.set(userId, {
      envelopeDigest,
      dek,
      expiresAtMs: nowMs() + this.dekCacheTtlMs,
    });
  }

  /**
   * Drop any cached DEK for `userId`. Called from every write path so a
   * sign-out / refresh / rotation cannot leave a usable DEK in memory
   * tied to a since-superseded envelope.
   */
  private invalidateCachedDek(userId: string): void {
    const entry = this.dekCache.get(userId);
    if (!entry) return;
    entry.dek.fill(0);
    this.dekCache.delete(userId);
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
      const status = getStatusCode(error);
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

    // Note: we deliberately do NOT filter expired records here. See the
    // TokenStore.getToken contract — the caller (resolveFreshGitHubToken)
    // needs the refresh token even when the access token is expired.

    const wrappedDek = Buffer.from(doc.wrappedDek, 'base64');
    const iv = Buffer.from(doc.iv, 'base64');
    const authTag = Buffer.from(doc.authTag, 'base64');
    const ciphertext = Buffer.from(doc.ciphertext, 'base64');

    const digest = this.envelopeDigest(doc.kekId, doc.wrappedDek);
    const cachedDek = this.getCachedDek(userId, digest);
    let dek: Buffer;
    let cacheHit = false;
    if (cachedDek) {
      dek = cachedDek;
      cacheHit = true;
    } else {
      const unwrap = await this.cryptographyClient.unwrapKey(KEY_WRAP_ALG, wrappedDek);
      dek = Buffer.from(unwrap.result);
    }
    let promotedToCache = false;
    try {
      const decipher = createDecipheriv(AEAD_ALG, dek, iv);
      decipher.setAuthTag(authTag);
      decipher.setAAD(
        buildAAD({
          userId: doc.userId,
          alg: doc.alg,
          kekId: doc.kekId,
          expiresAt: doc.expiresAt,
        }),
      );
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const parsed = JSON.parse(plaintext.toString('utf8')) as StoredToken;
      // Promote the DEK to the cache only after a successful decrypt
      // proves the envelope is intact. Ownership transfers to the cache,
      // which is responsible for zeroing on eviction.
      if (!cacheHit && this.dekCacheMaxEntries > 0) {
        this.putCachedDek(userId, digest, dek);
        promotedToCache = true;
      }
      return parsed;
    } finally {
      // Zero the DEK whenever this method still owns it:
      // - cache miss + cache disabled (we own the freshly unwrapped DEK)
      // - cache miss + decrypt threw before promotion (no other owner)
      // Cache-hit DEKs and successfully-promoted DEKs are owned by the
      // cache and must not be zeroed here.
      if (!cacheHit && !promotedToCache) {
        dek.fill(0);
      }
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
   * This path is unconditional; callers that need CAS semantics for
   * concurrent refresh use {@link setTokenIfNewer}.
   */
  async setToken(userId: string, token: StoredToken): Promise<void> {
    const doc = await this.buildEnvelope(userId, token);
    await this.container.items.upsert(doc, { disableAutomaticIdGeneration: true });
    this.invalidateCachedDek(userId);
  }

  /**
   * {@inheritDoc TokenStore.setTokenIfNewer}
   *
   * @remarks
   * Uses Cosmos optimistic concurrency:
   *
   * 1. Point-read the current document (with its `_etag`).
   * 2. If `existing.expiresAt >= token.expiresAt`, return `false` without
   *    encrypting or writing — the stored record is at least as fresh.
   * 3. Otherwise encrypt a fresh envelope and either `replace` with
   *    `If-Match: <etag>` (existing record) or `create` (absent record).
   * 4. A 412 Precondition Failed (replace race) or 409 Conflict (create
   *    race) means another writer won; return `false`. Any other error
   *    propagates.
   *
   * The compare is on `expiresAt` (cleartext on the document), so we don't
   * need to decrypt to make the decision — we only pay encryption when we
   * actually write.
   */
  async setTokenIfNewer(userId: string, token: StoredToken): Promise<boolean> {
    let existing: TokenDocument | undefined;
    let etag: string | undefined;
    try {
      const response = await this.container.item(userId, userId).read<TokenDocument>();
      existing = response.resource;
      etag = (response as { etag?: string }).etag;
    } catch (error) {
      const status = getStatusCode(error);
      if (status !== 404) throw error;
    }

    if (existing && existing.expiresAt >= token.expiresAt) {
      return false;
    }

    const doc = await this.buildEnvelope(userId, token);
    try {
      if (etag) {
        await this.container.item(userId, userId).replace(doc, {
          accessCondition: { type: 'IfMatch', condition: etag },
        });
      } else {
        await this.container.items.create(doc, { disableAutomaticIdGeneration: true });
      }
      this.invalidateCachedDek(userId);
      return true;
    } catch (error) {
      const status = getStatusCode(error);
      if (status === 412 || status === 409) {
        log.debug('setTokenIfNewer: concurrent writer won, skipping', { userId, status });
        return false;
      }
      throw error;
    }
  }

  /**
   * Build the encrypted envelope document for `token`. Extracted so that
   * {@link setToken} (unconditional upsert) and {@link setTokenIfNewer}
   * (CAS replace/create) share the encryption path. The DEK is zeroed in
   * `finally` to limit residency in memory.
   */
  private async buildEnvelope(userId: string, token: StoredToken): Promise<TokenDocument> {
    const dek = randomBytes(DEK_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    try {
      const cipher = createCipheriv(AEAD_ALG, dek, iv, { authTagLength: AUTH_TAG_LENGTH });
      cipher.setAAD(
        buildAAD({
          userId,
          alg: ENVELOPE_ALG,
          kekId: this.kekId,
          expiresAt: token.expiresAt,
        }),
      );
      const plaintext = Buffer.from(JSON.stringify(token), 'utf8');
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const wrap = await this.cryptographyClient.wrapKey(KEY_WRAP_ALG, dek);
      const wrappedDek = Buffer.from(wrap.result);

      return {
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
    } finally {
      dek.fill(0);
    }
  }

  async deleteToken(userId: string): Promise<void> {
    try {
      await this.container.item(userId, userId).delete();
    } catch (error) {
      const status = getStatusCode(error);
      if (status === 404) return;
      throw error;
    }
    this.invalidateCachedDek(userId);
  }

  /**
   * {@inheritDoc TokenStore.cleanupExpired}
   */
  async cleanupExpired(): Promise<number> {
    return 0;
  }
}

let defaultStore: TokenStore | null = null;

/**
 * Returns the process-wide default token store. The implementation is chosen
 * by {@link createDefaultTokenStore}.
 *
 * This function lazily initialises the store so local tests can import store
 * classes without constructing Azure clients.
 */
export function getTokenStore(): TokenStore {
  if (!defaultStore) {
    defaultStore = createDefaultTokenStore();
  }
  return defaultStore;
}

/**
 * Create the default token store for this process.
 *
 * @throws If `NODE_ENV=production` and no `AZURE_COSMOS_ENDPOINT` is set.
 */
export function createDefaultTokenStore(): TokenStore {
  const cosmosConfig = readCosmosConfigFromEnv();

  if (cosmosConfig) {
    log.info('Using CosmosTokenStore (Azure Cosmos DB + Key Vault envelope encryption)');
    return new CosmosTokenStore(cosmosConfig);
  }

  if (process.env.NODE_ENV === 'production') {
    const message =
      'Refusing to start: AZURE_COSMOS_ENDPOINT is not set in production. ' +
      'An encrypted, persistent token store is required. Configure Cosmos DB + Key Vault, ' +
      'or set NODE_ENV !== "production" to opt into the in-memory store.';
    log.error(message);
    throw new Error(message);
  }

  log.warn(
    'Using InMemoryTokenStore — tokens are kept in-process and lost on restart. ' +
      'This is fine for local development; do NOT use in production.',
  );
  return new InMemoryTokenStore();
}

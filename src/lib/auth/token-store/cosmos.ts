import { CosmosClient, type Container } from '@azure/cosmos';
import { DefaultAzureCredential, type TokenCredential } from '@azure/identity';
import { CryptographyClient } from '@azure/keyvault-keys';

import { logger } from '@/lib/logger';
import { nowMs } from '@/lib/utils/date-utils';
import {
  buildTokenEnvelope,
  decryptTokenDocument,
  envelopeDigest,
  KEY_WRAP_ALG,
  type TokenDocument,
} from './envelope';
import type { StoredToken, TokenStore } from './types';

const log = logger.withTag('TokenStore');

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

/**
 * Cosmos DB-backed token store with envelope encryption.
 *
 * - Payload encrypted with a fresh AES-256-GCM DEK per record (12-byte IV).
 * - DEK wrapped with Azure Key Vault KEK via `wrapKey(A256KW)`.
 * - Documents are partitioned by `userId`; reads are filtered by `userId`
 *   so a hostile or buggy caller cannot decrypt another user's row.
 *
 * Liskov: behaviourally identical to {@link TokenStore} implementations for callers.
 *
 * @remarks
 * **AAD invariant (do not change without a versioned migration).** Every
 * record's AES-GCM Additional Authenticated Data is built as a UTF-8 JSON
 * object with lexicographic key order:
 *
 * ```json
 * {"alg":"AES-256-GCM/A256KW","expiresAt":<n>,"kekId":"<url>","userId":"<id>"}
 * ```
 *
 * The AAD binds the ciphertext to its encryption context so a writer (or
 * attacker) cannot graft one user's `ciphertext + iv + authTag + wrappedDek`
 * into another user's document and have it decrypt. Reordering, renaming,
 * adding, or removing AAD fields silently invalidates every previously-written
 * ciphertext; bump a version field and migrate if the shape must change.
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
      this.dekCache.delete(userId);
      entry.dek.fill(0);
      return null;
    }
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
  private putCachedDek(userId: string, digest: string, dek: Buffer): void {
    if (this.dekCacheMaxEntries <= 0) return;
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
      envelopeDigest: digest,
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

    if (doc.userId !== userId) {
      log.warn('Refusing to decrypt token document with mismatched userId', {
        requested: userId,
        actual: doc.userId,
      });
      return null;
    }

    const wrappedDek = Buffer.from(doc.wrappedDek, 'base64');
    const digest = envelopeDigest(doc.kekId, doc.wrappedDek);
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
      const parsed = decryptTokenDocument(doc, dek);
      if (!cacheHit && this.dekCacheMaxEntries > 0) {
        this.putCachedDek(userId, digest, dek);
        promotedToCache = true;
      }
      return parsed;
    } finally {
      if (!cacheHit && !promotedToCache) {
        dek.fill(0);
      }
    }
  }

  async setToken(userId: string, token: StoredToken): Promise<void> {
    const doc = await this.buildEnvelope(userId, token);
    await this.container.items.upsert(doc, { disableAutomaticIdGeneration: true });
    this.invalidateCachedDek(userId);
  }

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

  private async buildEnvelope(userId: string, token: StoredToken): Promise<TokenDocument> {
    return buildTokenEnvelope(userId, token, this.kekId, async (dek) => {
      const wrap = await this.cryptographyClient.wrapKey(KEY_WRAP_ALG, dek);
      return Buffer.from(wrap.result);
    });
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

  async cleanupExpired(): Promise<number> {
    return 0;
  }
}

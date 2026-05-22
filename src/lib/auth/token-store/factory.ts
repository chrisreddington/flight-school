import { logger } from '@/lib/logger';
import { CosmosTokenStore, type CosmosTokenStoreConfig } from './cosmos';
import { InMemoryTokenStore } from './in-memory';
import type { TokenStore } from './types';

const log = logger.withTag('TokenStore');

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

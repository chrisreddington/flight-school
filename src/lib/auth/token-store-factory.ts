/**
 * Token Store Factory
 *
 * Selects the token store implementation based on environment configuration:
 *
 * - `AZURE_COSMOS_ENDPOINT` set → {@link CosmosTokenStore} with envelope
 *   encryption via Azure Key Vault (managed identity).
 * - Otherwise → {@link InMemoryTokenStore} for local development. A server
 *   restart drops sessions; that is the secure-by-default behaviour and is
 *   acceptable for `NODE_ENV !== 'production'`.
 *
 * In `NODE_ENV=production` with no Cosmos endpoint configured, the factory
 * throws to prevent accidentally deploying an in-memory store to production.
 */

import { logger } from '@/lib/logger';

import {
  CosmosTokenStore,
  InMemoryTokenStore,
  readCosmosConfigFromEnv,
  type TokenStore,
} from './token-store';

const log = logger.withTag('TokenStore');

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

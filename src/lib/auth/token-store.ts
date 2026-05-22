/**
 * Token Store Abstraction
 *
 * Provides a pluggable interface for persisting GitHub user-to-server (`ghu_`)
 * tokens outside the JWT cookie.
 *
 * Two implementations:
 *
 * - {@link InMemoryTokenStore}: process-local Map for local development and tests.
 * - {@link CosmosTokenStore}: Azure Cosmos DB-backed, with Key Vault envelope encryption.
 *
 * The {@link TokenStore} contract is the Liskov boundary: callers MUST be able
 * to swap implementations without behavioural change.
 */

export { CosmosTokenStore } from './token-store/cosmos';
export { createDefaultTokenStore, getTokenStore } from './token-store/factory';
export { InMemoryTokenStore } from './token-store/in-memory';
export type { StoredToken } from './token-store/types';

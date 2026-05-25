import { createCipheriv, randomBytes } from 'node:crypto';

/**
 * Test fixture for {@link CosmosTokenStore} envelope-encryption tests.
 *
 * Produces a Cosmos document that {@link CosmosTokenStore.setToken} would have
 * written, using the same DEK we return from the mocked `unwrapKey`. This lets
 * tests exercise the real decrypt path without a real Key Vault, and lets
 * AAD-tamper tests target individual envelope fields surgically.
 *
 * Excluded from the production-size budget by file-extension convention
 * (see `scripts/check-file-sizes.mjs`).
 */

export const FAKE_DEK = randomBytes(32);

export const baseCosmosConfig = {
  cosmosEndpoint: 'https://example.documents.azure.com',
  databaseId: 'db',
  containerId: 'tokens',
  keyVaultUrl: 'https://example.vault.azure.net',
  keyName: 'flight-school-kek',
};

export interface TokenInput {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt: number;
}

export interface EncryptedDoc {
  id: string;
  userId: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  wrappedDek: string;
  kekId: string;
  alg: 'AES-256-GCM/A256KW';
  createdAt: number;
  expiresAt: number;
}

export function encryptForTest(
  token: TokenInput,
  dek: Buffer,
  userId: string,
  overrides: { kekId?: string; aadExpiresAt?: number } = {},
): EncryptedDoc {
  const iv = randomBytes(12);
  const kekId = overrides.kekId ?? 'https://example.vault.azure.net/keys/flight-school-kek';
  const alg = 'AES-256-GCM/A256KW' as const;
  const aadExpiresAt = overrides.aadExpiresAt ?? token.expiresAt;
  const aad = Buffer.from(JSON.stringify({ alg, expiresAt: aadExpiresAt, kekId, userId }), 'utf8');
  const cipher = createCipheriv('aes-256-gcm', dek, iv, { authTagLength: 16 });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(token), 'utf8')), cipher.final()]);
  return {
    id: userId,
    userId,
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    wrappedDek: Buffer.from([0xaa, 0xbb]).toString('base64'),
    kekId,
    alg,
    createdAt: Math.floor(Date.now() / 1000),
    expiresAt: token.expiresAt,
  };
}

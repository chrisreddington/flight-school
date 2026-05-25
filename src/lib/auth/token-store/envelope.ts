import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { KnownEncryptionAlgorithms } from '@azure/keyvault-keys';

import { nowMs } from '@/lib/utils/date-utils';
import type { StoredToken } from './types';

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
export const KEY_WRAP_ALG = KnownEncryptionAlgorithms.A256KW;

/** Shape of the persisted Cosmos document. */
export interface TokenDocument {
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

export function envelopeDigest(kekId: string, wrappedDekBase64: string): string {
  return createHash('sha256').update(`${kekId}|${wrappedDekBase64}`).digest('base64');
}

export function decryptTokenDocument(doc: TokenDocument, dek: Buffer): StoredToken {
  const iv = Buffer.from(doc.iv, 'base64');
  const authTag = Buffer.from(doc.authTag, 'base64');
  const ciphertext = Buffer.from(doc.ciphertext, 'base64');
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
  return JSON.parse(plaintext.toString('utf8')) as StoredToken;
}

export async function buildTokenEnvelope(
  userId: string,
  token: StoredToken,
  kekId: string,
  wrapKey: (dek: Buffer) => Promise<Buffer>,
): Promise<TokenDocument> {
  const dek = randomBytes(DEK_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  try {
    const cipher = createCipheriv(AEAD_ALG, dek, iv, { authTagLength: AUTH_TAG_LENGTH });
    cipher.setAAD(
      buildAAD({
        userId,
        alg: ENVELOPE_ALG,
        kekId,
        expiresAt: token.expiresAt,
      }),
    );
    const plaintext = Buffer.from(JSON.stringify(token), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const wrappedDek = await wrapKey(dek);

    return {
      id: userId,
      userId,
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      wrappedDek: wrappedDek.toString('base64'),
      kekId,
      alg: ENVELOPE_ALG,
      createdAt: Math.floor(nowMs() / 1000),
      expiresAt: token.expiresAt,
    };
  } finally {
    dek.fill(0);
  }
}

/**
 * Build the canonical Additional Authenticated Data (AAD) for an AES-GCM
 * envelope. Emits a JSON object with deterministic lexicographic key order.
 */
function buildAAD(parts: { userId: string; alg: typeof ENVELOPE_ALG; kekId: string; expiresAt: number }): Buffer {
  const canonical = {
    alg: parts.alg,
    expiresAt: parts.expiresAt,
    kekId: parts.kekId,
    userId: parts.userId,
  };
  return Buffer.from(JSON.stringify(canonical), 'utf8');
}

/**
 * Token-store seeding at HTTP-request boundaries that enqueue background
 * work.
 *
 * Background-job executors (see `src/app/api/jobs/*` and
 * `src/lib/auth/token-resolver.ts`) read the user's refresh token from the
 * shared {@link TokenStore} at run-time instead of trusting an access
 * token captured at request time. That contract assumes the store already
 * has a record for the user.
 *
 * In a fresh sign-in the JWT-callback path persists the record, but a
 * pod rolling over, the user's record being swept, or the user authenticating
 * against a different replica's in-memory store can all leave the store
 * cold while the request still has a perfectly valid JWT cookie. The
 * seeder closes that gap: on every "I'm about to enqueue a job" boundary,
 * make sure the store has the same refresh material the JWT cookie carries.
 *
 * Uses the CAS write ({@link TokenStore.setTokenIfNewer}) so a concurrent
 * refresh on another replica that has already written a newer record is
 * never clobbered.
 */

import 'server-only';

import { logger } from '@/lib/logger';
import type { WorkerDispatchCredentials } from '@/lib/jobs/dispatch';

import { readCredentialsFromJwt } from './context';
import { getTokenStore } from './token-store';

const log = logger.withTag('TokenStoreSeed');

/** Outcome of a seed attempt. */
export type SeedResult =
  /** Seed succeeded — store has a record at least as new as the JWT cookie. */
  | { status: 'ok' }
  /** A newer record already exists in the store; nothing to do. */
  | { status: 'skipped-newer-exists' }
  /** JWT cookie does not carry an expiry (legacy or unrefreshed token); cannot seed. */
  | { status: 'skipped-no-expiry' }
  /** Store write failed; caller MUST NOT enqueue work. */
  | { status: 'error'; error: Error };

/**
 * Seed the TokenStore for the current request's user from the raw JWT.
 *
 * @param userId - Stable GitHub numeric ID of the authenticated user. The
 *   caller is expected to have already resolved this via
 *   `requireUserContext()`.
 * @returns A {@link SeedResult} describing the outcome.
 *
 * @remarks
 * The hot path is a single CAS write. If the store already has a strictly
 * newer record (because another replica refreshed concurrently), the CAS
 * returns false and we surface `skipped-newer-exists` — that is the
 * success-equivalent outcome and the caller may proceed to enqueue work.
 *
 * If the JWT does not carry an `expiresAt`, we cannot CAS safely (the
 * store would treat the seed as "unknown age" and either overwrite a
 * newer record or be skipped indefinitely). In that case we surface
 * `skipped-no-expiry` and the caller may still proceed — the executor
 * will fail with a re-auth-required signal when it tries to resolve a
 * fresh token, which is the correct UX.
 *
 * If the store write itself throws, the caller MUST NOT enqueue the job.
 * Returning success while the store is unwritable would leave the
 * executor with no credentials and no way to recover.
 */
export async function seedTokenStoreFromJwt(userId: string): Promise<SeedResult> {
  const creds = await readCredentialsFromJwt();
  if (!creds) {
    log.warn('No JWT credentials available to seed token store', { userId });
    return { status: 'skipped-no-expiry' };
  }

  if (!creds.expiresAt || creds.expiresAt <= 0) {
    log.debug('JWT carries no expiresAt; skipping CAS seed', { userId });
    return { status: 'skipped-no-expiry' };
  }

  const store = getTokenStore();
  try {
    const wrote = await store.setTokenIfNewer(userId, {
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
      expiresAt: creds.expiresAt,
    });
    if (wrote) {
      return { status: 'ok' };
    }
    return { status: 'skipped-newer-exists' };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error('Failed to seed token store from JWT', { userId, message: error.message });
    return { status: 'error', error };
  }
}

export async function buildWorkerDispatchCredentials(): Promise<WorkerDispatchCredentials | null> {
  const creds = await readCredentialsFromJwt();
  if (!creds?.accessToken || !creds.refreshToken || !creds.expiresAt || creds.expiresAt <= 0) {
    return null;
  }

  return {
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken,
    expiresAt: creds.expiresAt,
  };
}

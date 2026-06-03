/**
 * Child entrypoint for the cross-process SQLite integration tests
 * ({@link ../cross-process.integration.test.ts}). One process per `MODE`,
 * each opening its OWN connection to the shared on-disk WAL database so the
 * test exercises real multi-process contention and visibility — something an
 * in-process or `:memory:` store can never model.
 *
 * Run via `tsx --tsconfig tsconfig.cross-process.json` so the worker-only
 * `server-only` guard resolves to the test shim (the same alias Vitest uses).
 *
 * Modes (selected by the `MODE` env var):
 * - `cas`         — run a compare-and-swap increment loop against a shared
 *                   counter document, retrying on conflict, then print
 *                   `OK <successfulIncrements>`.
 * - `register`    — register a brand-new user and write their first document,
 *                   then print `OK <RegistrationOutcome>`.
 * - `collect`     — open a fresh store and print `USERS <json-array>` of every
 *                   registered user id (proving cross-process write visibility).
 * - `unregister`  — remove a user's registry entry, then print `OK`.
 */

import { createSqliteDocumentStore } from '@/lib/storage/document-store/sqlite-adapter';
import {
  collectRegisteredUsers,
  ensureUserRegistered,
  removeUserRegistration,
} from '@/lib/storage/document-store/user-registry';
import { DocumentConflictError, type DocumentStore } from '@/lib/storage/document-store/types';

/** The shared counter document the CAS contention test increments. */
interface CounterBody {
  value: number;
}

const COUNTER_PARTITION = 'cross-process';
const COUNTER_ID = 'counter';

/** Sleep a tiny jittered interval so retrying workers desynchronise. */
function backoff(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
}

/** Whether an error is a transient SQLite write-lock contention (vs a real bug). */
function isBusyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /SQLITE_BUSY|database is locked|database table is locked/i.test(message);
}

/**
 * Increment the shared counter `increments` times under CAS, retrying on a
 * conflicting etag or a transient busy lock. Returns the number of increments
 * this process committed (always equal to `increments` on success).
 */
async function runCasIncrements(store: DocumentStore, increments: number): Promise<number> {
  let committed = 0;
  while (committed < increments) {
    const envelope = await store.getEnvelope<CounterBody>('system', COUNTER_PARTITION, COUNTER_ID);
    if (!envelope) {
      throw new Error('counter document missing — parent must seed it before forking');
    }
    try {
      await store.put<CounterBody>(
        'system',
        COUNTER_PARTITION,
        COUNTER_ID,
        { value: envelope.body.value + 1 },
        { ifMatch: envelope.etag },
      );
      committed += 1;
    } catch (error) {
      if (error instanceof DocumentConflictError || isBusyError(error)) {
        await backoff();
        continue;
      }
      throw error;
    }
  }
  return committed;
}

/** Read the required `USER_ID` env var or fail loudly. */
function requireUserId(): string {
  const userId = process.env.USER_ID;
  if (!userId) {
    throw new Error('USER_ID env var is required for this mode');
  }
  return userId;
}

async function main(): Promise<void> {
  const mode = process.env.MODE;
  const dbPath = process.env.DB;
  if (!dbPath) {
    throw new Error('DB env var (database path) is required');
  }
  const store = await createSqliteDocumentStore({ dbPath });

  if (mode === 'cas') {
    const increments = Number(process.env.INCREMENTS);
    if (!Number.isInteger(increments) || increments <= 0) {
      throw new Error('INCREMENTS env var must be a positive integer');
    }
    const committed = await runCasIncrements(store, increments);
    process.stdout.write(`OK ${committed}`);
    return;
  }

  if (mode === 'register') {
    const userId = requireUserId();
    const outcome = await ensureUserRegistered(store, userId);
    await store.put('skills', userId, 'current', { seeded: true }, { ifNoneMatch: '*' });
    process.stdout.write(`OK ${outcome}`);
    return;
  }

  if (mode === 'collect') {
    const userIds = await collectRegisteredUsers(store);
    process.stdout.write(`USERS ${JSON.stringify(userIds)}`);
    return;
  }

  if (mode === 'unregister') {
    await removeUserRegistration(store, requireUserId());
    process.stdout.write('OK');
    return;
  }

  throw new Error(`unknown MODE "${mode ?? ''}"`);
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});

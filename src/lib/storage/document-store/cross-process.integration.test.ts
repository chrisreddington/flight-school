/**
 * @vitest-environment node
 *
 * Cross-process integration tests for the SQLite document store. These fork
 * real OS processes (via `tsx`) that each open their own connection to a
 * shared on-disk WAL database, exercising two guarantees that single-process
 * tests cannot prove:
 *
 * 1. **CAS holds under multi-process contention** — concurrent writers racing
 *    on the same document never lose an update, because `put({ ifMatch })`
 *    rejects stale etags and WAL + `busy_timeout` serialise the commits.
 * 2. **Registry writes are visible across processes** — a user registered by
 *    one process is seen (and, once removed, un-seen) by a freshly started
 *    process reading the sharded registry.
 *
 * The child runs in {@link ./__fixtures__/cross-process-child.ts} and is
 * launched with the repo-root `tsconfig.cross-process.json` so the worker-only
 * `server-only` import resolves to the test shim outside Vitest.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSqliteDocumentStore } from './sqlite-adapter';

const requireFromHere = createRequire(import.meta.url);
const tsxCliPath = requireFromHere.resolve('tsx/cli');
const repoRoot = join(__dirname, '..', '..', '..', '..');
const crossProcessTsconfig = join(repoRoot, 'tsconfig.cross-process.json');
const childEntrypoint = join(__dirname, '__fixtures__', 'cross-process-child.ts');

/** Process count and per-process increment count for the CAS contention test. */
const CONCURRENT_WORKERS = 3;
const INCREMENTS_PER_WORKER = 20;

/** Forking + cold `tsx` start is slow; give each test ample headroom. */
const CROSS_PROCESS_TIMEOUT_MS = 60_000;

interface ChildResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/** Counter document shape mirrored from the child fixture. */
interface CounterBody {
  value: number;
}

/**
 * Fork one child process in the given `MODE` against the shared database,
 * resolving with its captured stdout/stderr and exit code.
 */
function runChild(mode: string, extraEnv: NodeJS.ProcessEnv, dbPath: string): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn('node', [tsxCliPath, '--tsconfig', crossProcessTsconfig, childEntrypoint], {
      env: { ...process.env, MODE: mode, DB: dbPath, ...extraEnv },
    });

    let stdout = '';
    let stderr = '';
    childProcess.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    childProcess.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    childProcess.on('error', reject);
    childProcess.on('close', (exitCode) => {
      resolve({ exitCode, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

describe('SQLite document store cross-process integration', () => {
  let workingDirectory: string;
  let databasePath: string;

  beforeEach(async () => {
    workingDirectory = await mkdtemp(join(tmpdir(), 'flight-school-xproc-'));
    databasePath = join(workingDirectory, 'docstore.sqlite');
  });

  afterEach(async () => {
    await rm(workingDirectory, { recursive: true, force: true });
  });

  it(
    'never loses an update when concurrent processes race CAS increments',
    async () => {
      // Open the store in-parent first so the schema exists and the counter is
      // seeded before any child races to write it.
      const seedStore = await createSqliteDocumentStore({ dbPath: databasePath });
      await seedStore.put<CounterBody>('system', 'cross-process', 'counter', { value: 0 });

      const workers = Array.from({ length: CONCURRENT_WORKERS }, () =>
        runChild('cas', { INCREMENTS: String(INCREMENTS_PER_WORKER) }, databasePath),
      );
      const results = await Promise.all(workers);

      for (const result of results) {
        expect(result.stderr).toBe('');
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe(`OK ${INCREMENTS_PER_WORKER}`);
      }

      // A fresh connection must observe every committed increment with no loss.
      const verifyStore = await createSqliteDocumentStore({ dbPath: databasePath });
      const finalCounter = await verifyStore.getEnvelope<CounterBody>('system', 'cross-process', 'counter');
      expect(finalCounter?.body.value).toBe(CONCURRENT_WORKERS * INCREMENTS_PER_WORKER);
    },
    CROSS_PROCESS_TIMEOUT_MS,
  );

  it(
    'makes a registry write from one process visible to a later process',
    async () => {
      const userId = 'cross-process-user';

      // Construct the schema in-parent before forking so children never race
      // the `CREATE TABLE IF NOT EXISTS` DDL at startup.
      await createSqliteDocumentStore({ dbPath: databasePath });

      const registerResult = await runChild('register', { USER_ID: userId }, databasePath);
      expect(registerResult.stderr).toBe('');
      expect(registerResult.exitCode).toBe(0);
      expect(registerResult.stdout).toBe('OK created');

      const afterRegister = await runChild('collect', {}, databasePath);
      expect(afterRegister.exitCode).toBe(0);
      expect(JSON.parse(afterRegister.stdout.replace(/^USERS /, ''))).toContain(userId);

      const unregisterResult = await runChild('unregister', { USER_ID: userId }, databasePath);
      expect(unregisterResult.exitCode).toBe(0);

      const afterUnregister = await runChild('collect', {}, databasePath);
      expect(afterUnregister.exitCode).toBe(0);
      expect(JSON.parse(afterUnregister.stdout.replace(/^USERS /, ''))).not.toContain(userId);
    },
    CROSS_PROCESS_TIMEOUT_MS,
  );
});

#!/usr/bin/env node
/**
 * CLI entrypoint for the legacy → docstore importer
 * ({@link runStorageMigration}).
 *
 * Why this runner exists: `migrate.ts` lives in the Next.js module graph and
 * transitively imports modules guarded by the `server-only` marker. Running it
 * under the `react-server` Node condition resolves that marker to a no-op, and
 * `--import tsx` lets Node execute the TypeScript source (and resolve the `@/`
 * path alias) without a separate build step:
 *
 *   node --conditions=react-server --import tsx scripts/storage-migrate.mts
 *
 * The `storage:migrate` npm script wires those flags up; invoke it as
 * `npm run storage:migrate -- --dry-run` (note the `--` so npm forwards flags).
 *
 * Flags:
 *   --dry-run          Report counts without writing anything.
 *   --force            Overwrite divergent envelopes instead of skipping them.
 *   --user <id>        Migrate only this single user id.
 *   --assume-quiesced  Assert the app is stopped (required on the file backend).
 */

import {
  runStorageMigration,
  StorageMigrationLockError,
  StorageMigrationRefusedError,
  StorageMigrationUserError,
  type StorageMigrationOptions,
} from '@/lib/storage/migrate';

/** Parses the supported argv flags, rejecting unknown tokens. */
function parseArgs(argv: string[]): StorageMigrationOptions {
  const options: StorageMigrationOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--assume-quiesced':
        options.assumeQuiesced = true;
        break;
      case '--user': {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) {
          throw new Error('--user requires a user id argument');
        }
        options.user = value;
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const summary = await runStorageMigration(options);
  const prefix = summary.dryRun ? '(dry-run) ' : '';
  const { counts } = summary;
  process.stdout.write(
    `${prefix}Storage migration ${summary.status} on the ${summary.backend} backend.\n` +
      `${prefix}Users processed: ${summary.usersProcessed}\n` +
      `${prefix}inserted=${counts.inserted} overwritten=${counts.overwritten} ` +
      `unchanged=${counts.unchanged} skippedDivergent=${counts.skippedDivergent} ` +
      `skippedCorrupt=${counts.skippedCorrupt} failures=${counts.failures}\n`,
  );
  if (counts.failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  if (
    error instanceof StorageMigrationRefusedError ||
    error instanceof StorageMigrationLockError ||
    error instanceof StorageMigrationUserError
  ) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  process.stderr.write(`Storage migration failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

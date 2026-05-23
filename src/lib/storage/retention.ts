/**
 * @deprecated Use `./user-retention` or `@/worker/jobs/retention` directly.
 * This barrel exists for 2B.1 transition while web routes and the cron
 * sweeper still import from the legacy path. Once 2B.2 lands the cron
 * route will call the worker proxy and this file can be deleted.
 *
 * @module storage/retention
 */

export * from './user-retention';
export { sweepStaleRunningJobs, sweepOrphanJobs, redactTerminalJobs } from '@/worker/jobs/retention';

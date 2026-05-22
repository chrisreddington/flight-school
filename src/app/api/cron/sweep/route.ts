/**
 * `POST /api/cron/sweep` — global retention sweeper.
 *
 * Runs every per-user sweep (threads / evaluations / job scratchpads)
 * plus the global stale-running and orphan-job sweeps. Intended to be
 * invoked on a fixed cadence (e.g. hourly) by an Azure Container Apps
 * Job authenticated via Entra ID. Returns aggregate counts only — no
 * user content ever leaves the server through this route.
 *
 * Auth: {@link verifyCronRequest} enforces a real Entra-issued bearer
 * token with `iss` / `aud` / `nbf` / `exp` / `appid`-allowlist checks.
 * `CRON_SKIP_AUTH=1` is honoured ONLY when `NODE_ENV === 'test'`.
 */

import { logger } from '@/lib/logger';
import {
  redactTerminalJobs,
  sweepAllUsers,
  sweepOrphanJobs,
  sweepStaleRunningJobs,
} from '@/lib/storage/retention';
import { CronAuthError, verifyCronRequest } from '@/lib/security/cron-auth';
import { NextResponse } from 'next/server';

const log = logger.withTag('CronSweep');

export async function POST(request: Request) {
  try {
    const payload = await verifyCronRequest(request);
    const callerAppid = (typeof payload.appid === 'string' && payload.appid)
      || (typeof payload.azp === 'string' && payload.azp)
      || 'unknown';

    log.info('Cron sweep starting', { callerAppid });

    const nowMs = Date.now();
    const userSweeps = await sweepAllUsers(nowMs);
    const staleRunning = await sweepStaleRunningJobs(nowMs);
    const orphanJobs = await sweepOrphanJobs();
    const redactedJobs = await redactTerminalJobs();

    const summary = {
      threads: userSweeps.threads,
      evaluations: userSweeps.evaluations,
      scratchpads: userSweeps.scratchpads,
      staleRunningJobs: staleRunning,
      orphanJobs,
      redactedTerminalJobs: redactedJobs,
    };

    log.info('Cron sweep complete', summary);
    return NextResponse.json({ success: true, summary, sweptAt: new Date(nowMs).toISOString() });
  } catch (err) {
    if (err instanceof CronAuthError) {
      log.warn('Cron auth rejected', { message: err.message });
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    log.error('Cron sweep failed', { error: err });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

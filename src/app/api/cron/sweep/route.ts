/**
 * `POST /api/cron/sweep` — global retention sweeper.
 *
 * Runs every per-user sweep (threads / evaluations) plus the global
 * stale-running and orphan-job sweeps. Intended to be invoked on a
 * fixed cadence (e.g. hourly) by an Azure Container Apps Job
 * authenticated via Entra ID. Returns aggregate counts only — no
 * user content ever leaves the server through this route.
 *
 * Auth: {@link verifyCronRequest} enforces a real Entra-issued bearer
 * token with `iss` / `aud` / `nbf` / `exp` / `appid`-allowlist checks.
 * `CRON_SKIP_AUTH=1` is honoured ONLY when `NODE_ENV === 'test'`.
 */

import { logger } from '@/lib/logger';
import { sweepAllUsers } from '@/lib/storage/user-retention';
import { sweepWorkerJobs } from '@/app/api/jobs/worker-client';
import { captureTracePropagationHeaders } from '@/lib/observability/context-propagation';
import { CronAuthError, verifyCronRequest } from '@/lib/security/cron-auth';
import { NextResponse } from 'next/server';

const log = logger.withTag('CronSweep');

export async function POST(request: Request) {
  try {
    const payload = await verifyCronRequest(request);
    const callerAppid =
      (typeof payload.appid === 'string' && payload.appid) ||
      (typeof payload.azp === 'string' && payload.azp) ||
      'unknown';

    log.info('Cron sweep starting', { callerAppid });

    const nowMs = Date.now();
    const traceCtxRaw = captureTracePropagationHeaders();
    const traceCtx = Object.keys(traceCtxRaw).length > 0 ? traceCtxRaw : undefined;

    // Run user and worker sweeps independently so a worker outage doesn't
    // block local cleanup (and vice versa). Surface per-step status in
    // the response so on-call can see exactly which side failed.
    const [userResult, jobResult] = await Promise.allSettled([
      sweepAllUsers(nowMs),
      sweepWorkerJobs({ nowMs, traceContext: traceCtx }),
    ]);

    const userSweeps = userResult.status === 'fulfilled' ? userResult.value : null;
    const jobSweeps = jobResult.status === 'fulfilled' ? jobResult.value : null;

    if (userResult.status === 'rejected') {
      log.error('Cron user-sweep failed', { error: userResult.reason });
    }
    if (jobResult.status === 'rejected') {
      log.error('Cron job-sweep failed', { error: jobResult.reason });
    }

    const summary = {
      threads: userSweeps?.threads ?? null,
      evaluations: userSweeps?.evaluations ?? null,
      staleRunningJobs: jobSweeps?.staleRunningJobs ?? null,
      orphanJobs: jobSweeps?.orphanJobs ?? null,
      redactedTerminalJobs: jobSweeps?.redactedTerminalJobs ?? null,
    };

    const steps = {
      userSweep: userResult.status,
      jobSweep: jobResult.status,
    };

    const allOk = userResult.status === 'fulfilled' && jobResult.status === 'fulfilled';
    log.info('Cron sweep complete', { summary, steps, allOk });

    return NextResponse.json(
      {
        success: allOk,
        summary,
        steps,
        sweptAt: new Date(nowMs).toISOString(),
      },
      // Partial success surfaces as 207 so monitoring can alert without
      // re-running a healthy step. Total success stays 200.
      { status: allOk ? 200 : 207 },
    );
  } catch (err) {
    if (err instanceof CronAuthError) {
      log.warn('Cron auth rejected', { message: err.message });
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    log.error('Cron sweep failed', { error: err });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * Per-user data deletion endpoint.
 *
 * `DELETE /api/user/data` — irreversibly deletes all server-side data
 * belonging to the authenticated caller:
 *
 *   - their entire `users/{userId}/` storage subtree (threads,
 *     evaluations, suggestions, focus, anything else partitioned per
 *     user)
 *   - every {@link BackgroundJob} they own (cancelling any in-flight
 *     ones first)
 *   - every {@link AIActivityEvent} they own in the in-memory activity
 *     buffer
 *
 * This is the user-facing GDPR / data-retention escape hatch. It does
 * NOT delete:
 *   - the Auth.js session token store (sign-out handles that)
 *   - SDK on-disk session-state under `~/.copilot/session-state/{id}/`,
 *     because those are keyed by session id (not user id) and are
 *     covered by Phase C's compaction sweeper
 *
 * Cross-user deletion is impossible by construction: every operation is
 * filtered by the server-resolved `userId` from {@link requireUserContext}.
 */

import { requireUserContext, UnauthorizedError } from '@/lib/auth/context';
import { activityLogger } from '@/lib/copilot/activity/logger';
import { jobStorage } from '@/lib/jobs';
import { deleteDir } from '@/lib/storage/utils';
import { markUserDeleted } from '@/lib/storage/tombstone';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { cancelRunningJob } from '../../jobs/route';

const log = logger.withTag('UserDataAPI');

interface DeleteSummary {
  jobsCancelled: number;
  jobsDeleted: number;
  activityEventsCleared: boolean;
  storageDirDeleted: boolean;
}

interface DeleteRequestBody {
  /**
   * The caller's GitHub login. Must match the server-resolved
   * `session.user.login` exactly. Modal-only confirmation is UX, not
   * security; server enforcement is mandatory (rubber-duck #10).
   */
  confirmLogin?: string;
}

/** Throw if the request's Origin header isn't same-origin with Host. */
function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) {
    throw new Response(JSON.stringify({ error: 'Missing Origin header' }), { status: 400 });
  }
  try {
    const url = new URL(origin);
    if (url.host !== host) {
      throw new Response(JSON.stringify({ error: 'Cross-origin requests are not allowed' }), { status: 403 });
    }
  } catch {
    throw new Response(JSON.stringify({ error: 'Invalid Origin header' }), { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    try {
      assertSameOrigin(request);
    } catch (resp) {
      if (resp instanceof Response) return resp;
      throw resp;
    }

    const { userId, login } = await requireUserContext();

    // Body confirmation: caller must echo their own GitHub login back to
    // us. Anything else (missing header, wrong login, no body) is
    // rejected without touching state.
    let body: DeleteRequestBody = {};
    try {
      body = (await request.json()) as DeleteRequestBody;
    } catch {
      return NextResponse.json(
        { error: 'Request body must include { confirmLogin: "<your GitHub login>" }.' },
        { status: 400 },
      );
    }
    if (typeof body.confirmLogin !== 'string' || body.confirmLogin !== login) {
      return NextResponse.json(
        { error: 'confirmLogin does not match the authenticated user.' },
        { status: 400 },
      );
    }

    log.info(`[user ${userId}] Deleting all server-side data on user request`);

    // Set the deletion tombstone FIRST so any in-flight executor that
    // tries to flush a final delta after cancellation aborts cleanly
    // instead of recreating the user's directory.
    await markUserDeleted(userId);

    // Cancel any in-flight jobs for this user before removing their records.
    const allJobs = await jobStorage.getAll();
    const ownedRunning = allJobs.filter(
      (j) => j.userId === userId && (j.status === 'running' || j.status === 'pending'),
    );

    let jobsCancelled = 0;
    for (const job of ownedRunning) {
      const cancelled = await cancelRunningJob(job.id);
      if (cancelled) jobsCancelled += 1;
    }

    const { deleted: jobsDeleted } = await jobStorage.deleteForUser(userId);

    // Clear this user's slice of the activity buffer.
    activityLogger.clear(userId);

    // Wipe the entire per-user storage directory (threads, evaluations,
    // suggestions, focus, etc.). `deleteDir` is recursive and a no-op
    // when the directory doesn't exist.
    await deleteDir(`users/${userId}`);

    // Restore the tombstone marker after deleteDir wipes it (deleteDir
    // recursively removes everything under `users/{userId}/` including
    // `.deleted`). The marker must remain in place until the user signs
    // in again so any late executor write still aborts.
    await markUserDeleted(userId);

    const summary: DeleteSummary = {
      jobsCancelled,
      jobsDeleted,
      activityEventsCleared: true,
      storageDirDeleted: true,
    };

    log.info(`[user ${userId}] data deletion complete`, summary);

    return NextResponse.json({ success: true, summary });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
